from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

import numpy as np
import onnx
from onnx import ModelProto, NodeProto, TensorProto

from .onnx_graph_utils import (
    build_initializer_map,
    build_node_map,
    build_output_to_node,
    tensor_proto_to_numpy,
)


@dataclass
class MoEOpInfo:
    node: NodeProto
    op_type: str  # 'QMoE' or 'MoE'
    domain: str
    layer_index: int
    num_experts: int
    top_k: int
    hidden_size: int
    activation_type: str
    norm_type: str

    # 入出力テンソル名
    input_hidden: str
    input_router_weights: Optional[str]
    output: str
    output_router_logits: Optional[str]

    # Expert重みテンソル (取得可能な場合)
    expert_weights: Dict[str, TensorProto] = field(default_factory=dict)


@dataclass
class MoEModelInfo:
    model_id: str
    num_layers: int
    hidden_size: int
    num_attention_heads: int
    num_key_value_heads: int
    vocab_size: int
    moe_layers: List[MoEOpInfo]
    dense_layer_count: int

    # MoE以外のレイヤー情報
    has_embedding: bool = True
    has_output_head: bool = True
    intermediate_size: int = 0


KNOWN_MOE_OPS = {
    "QMoE",
    "MoE",
}


def detect_moe_ops(model: ModelProto) -> List[MoEOpInfo]:
    graph = model.graph
    moe_ops: List[MoEOpInfo] = []

    node_map = build_node_map(graph)

    for node in graph.node:
        if node.op_type in KNOWN_MOE_OPS:
            info = _parse_moe_op(node, node_map, graph)
            if info:
                moe_ops.append(info)

    moe_ops.sort(key=lambda x: x.layer_index)
    return moe_ops


def _parse_moe_op(
    node: NodeProto,
    node_map: Dict[str, NodeProto],
    graph: onnx.GraphProto,
) -> Optional[MoEOpInfo]:
    attrs = {a.name: a for a in node.attribute}

    num_experts = _get_attr_int(attrs, "num_experts", 0)
    top_k = _get_attr_int(attrs, "k", 0) or _get_attr_int(attrs, "top_k", 0)
    hidden_size = _get_attr_int(attrs, "hidden_size", 0)
    activation_type = _get_attr_str(attrs, "activation_type", "gelu")
    norm_type = _get_attr_str(attrs, "norm_type", "none")

    domain = node.domain or "ai.onnx.contrib"

    inputs = list(node.input)
    outputs = list(node.output)

    input_hidden = inputs[0] if len(inputs) > 0 else ""
    input_router_weights = inputs[1] if len(inputs) > 1 else None
    output = outputs[0] if len(outputs) > 0 else ""
    output_router_logits = outputs[1] if len(outputs) > 1 else None

    layer_index = _infer_layer_index(node, node_map)

    expert_weights = _extract_expert_weights(node, graph)

    return MoEOpInfo(
        node=node,
        op_type=node.op_type,
        domain=domain,
        layer_index=layer_index,
        num_experts=num_experts,
        top_k=top_k,
        hidden_size=hidden_size,
        activation_type=activation_type,
        norm_type=norm_type,
        input_hidden=input_hidden,
        input_router_weights=input_router_weights,
        output=output,
        output_router_logits=output_router_logits,
        expert_weights=expert_weights,
    )


def _get_attr_int(attrs, name: str, default: int = 0) -> int:
    attr = attrs.get(name)
    if attr is None:
        return default
    return attr.i


def _get_attr_str(attrs, name: str, default: str = "") -> str:
    attr = attrs.get(name)
    if attr is None:
        return default
    return attr.s.decode("utf-8") if isinstance(attr.s, bytes) else attr.s


def _infer_layer_index(node: NodeProto, node_map: Dict[str, NodeProto]) -> int:
    name = node.name or ""
    import re

    patterns = [
        r"layers?[._]?(\d+)",
        r"layer[._]?(\d+)",
        r"block[._]?(\d+)",
        r"transformer[._]?(\d+)",
    ]
    for pat in patterns:
        m = re.search(pat, name, re.IGNORECASE)
        if m:
            return int(m.group(1))

    for input_name in node.input:
        for pat in patterns:
            m = re.search(pat, input_name, re.IGNORECASE)
            if m:
                return int(m.group(1))

    return 0


def _extract_expert_weights(
    node: NodeProto, graph: onnx.GraphProto
) -> Dict[str, TensorProto]:
    initializer_map = build_initializer_map(graph)
    output_to_node = build_output_to_node(graph)
    expert_weights: Dict[str, TensorProto] = {}

    node_name_prefix = node.name or ""
    for init_name, tensor in initializer_map.items():
        if node_name_prefix and node_name_prefix in init_name:
            if any(kw in init_name.lower() for kw in ["expert", "gate", "up", "down"]):
                expert_weights[init_name] = tensor

    return expert_weights


def infer_model_config(model: ModelProto) -> MoEModelInfo:
    graph = model.graph
    moe_ops = detect_moe_ops(model)

    config: Dict[str, int] = {
        "num_layers": 0,
        "hidden_size": 0,
        "num_attention_heads": 0,
        "num_key_value_heads": 0,
        "vocab_size": 0,
        "intermediate_size": 0,
    }

    if moe_ops:
        config["num_layers"] = moe_ops[-1].layer_index + 1
        config["hidden_size"] = moe_ops[0].hidden_size

    for inp in graph.input:
        if inp.name == "input_ids":
            shape = inp.type.tensor_type.shape
            if shape.dim:
                config["vocab_size"] = shape.dim[-1].dim_value

    initializer_map = build_initializer_map(graph)

    embed_weight_names = [k for k in initializer_map if "embed" in k.lower() and "weight" in k.lower()]
    if embed_weight_names:
        t = initializer_map[embed_weight_names[0]]
        shape = list(t.dims)
        if len(shape) >= 2:
            config["vocab_size"] = shape[0]
            config["hidden_size"] = shape[1]

    for node in graph.node:
        if node.op_type == "Attention":
            for a in node.attribute:
                if a.name == "num_heads":
                    config["num_attention_heads"] = a.i
                if a.name == "kv_num_heads":
                    config["num_key_value_heads"] = a.i

    num_layers = config["num_layers"]
    hidden_size = config["hidden_size"]

    num_expert_layers = len(moe_ops)
    dense_layer_count = num_layers - num_expert_layers if num_layers > 0 else 0

    return MoEModelInfo(
        model_id=model.graph.name or "unknown",
        num_layers=num_layers or 48,
        hidden_size=hidden_size or 2048,
        num_attention_heads=config["num_attention_heads"] or 16,
        num_key_value_heads=config["num_key_value_heads"] or 4,
        vocab_size=config["vocab_size"] or 151936,
        moe_layers=moe_ops,
        dense_layer_count=dense_layer_count,
        intermediate_size=config["intermediate_size"] or 0,
    )


def format_model_info(info: MoEModelInfo) -> str:
    lines = [
        f"Model: {info.model_id}",
        f"  Layers: {info.num_layers} ({info.dense_layer_count} dense + {len(info.moe_layers)} MoE)",
        f"  Hidden size: {info.hidden_size}",
        f"  Attention heads: {info.num_attention_heads}",
        f"  KV heads: {info.num_key_value_heads}",
        f"  Vocab size: {info.vocab_size}",
        f"  MoE layers: {len(info.moe_layers)}",
    ]

    if info.moe_layers:
        m = info.moe_layers[0]
        lines.append(f"  Op type: {m.op_type}")
        lines.append(f"  Num experts per layer: {m.num_experts}")
        lines.append(f"  Top-K: {m.top_k}")
        lines.append(f"  Activation: {m.activation_type}")

        expert_total = 0
        for init_name, tensor in m.expert_weights.items():
            expert_total += 1
        lines.append(f"  Expert weight tensors found: {expert_total}")

    return "\n".join(lines)
