from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Set

import onnx
from onnx import ModelProto, NodeProto, TensorProto, ValueInfoProto, helper
import numpy as np

from .moe_op_detector import MoEModelInfo, MoEOpInfo
from .onnx_graph_utils import (
    GraphPartition,
    build_initializer_map,
    build_node_map,
    build_output_to_node,
    build_value_info_map,
    extract_subgraph,
    get_tensor_shape,
    make_model_from_partition,
    rename_node_outputs,
    tensor_proto_to_numpy,
)


def split_for_coordinator(
    model: ModelProto,
    model_info: MoEModelInfo,
    opset_imports: Optional[List[onnx.OperatorSetIdProto]] = None,
) -> ModelProto:
    graph = model.graph

    if opset_imports is None:
        opset_imports = list(model.opset_import)

    moe_node_names: Set[str] = {m.node.name for m in model_info.moe_layers}

    graph_outputs = list(graph.output)
    output_names = [o.name for o in graph_outputs]

    partition = extract_subgraph(graph, output_names, stop_at_nodes=moe_node_names)

    coordinator_outputs = _add_router_outputs(
        partition, model_info, graph, output_names
    )

    coord_graph = helper.make_graph(
        nodes=partition.nodes,
        name="coordinator",
        inputs=partition.inputs,
        outputs=coordinator_outputs,
        initializer=partition.initializers,
    )

    coord_model = helper.make_model(
        coord_graph,
        opset_imports=opset_imports,
        producer_name="flaxia-moe-splitter",
    )
    coord_model.ir_version = onnx.IR_VERSION
    return coord_model


def _add_router_outputs(
    partition: GraphPartition,
    model_info: MoEModelInfo,
    original_graph: onnx.GraphProto,
    existing_outputs: List[str],
) -> List[ValueInfoProto]:
    output_value_infos = list(partition.outputs)
    seen_names = {o.name for o in output_value_infos}

    value_info_map = build_value_info_map(original_graph)

    for moe in model_info.moe_layers:
        if moe.output_router_logits and moe.output_router_logits not in seen_names:
            vi = value_info_map.get(moe.output_router_logits)
            if vi:
                output_value_infos.append(vi)
                seen_names.add(moe.output_router_logits)
            else:
                output_value_infos.append(
                    helper.make_tensor_value_info(
                        moe.output_router_logits,
                        TensorProto.FLOAT,
                        [-1, moe.num_experts],
                    )
                )
                seen_names.add(moe.output_router_logits)

    return output_value_infos


def split_for_experts(
    model: ModelProto,
    model_info: MoEModelInfo,
    output_dir: Path,
    opset_imports: Optional[List[onnx.OperatorSetIdProto]] = None,
) -> Dict[int, Path]:
    graph = model.graph

    if opset_imports is None:
        opset_imports = list(model.opset_import)

    initializer_map = build_initializer_map(graph)
    output_to_node = build_output_to_node(graph)
    node_map = build_node_map(graph)
    value_info_map = build_value_info_map(graph)

    expert_paths: Dict[int, Path] = {}

    for layer_idx, moe in enumerate(model_info.moe_layers):
        num_experts = moe.num_experts
        for expert_idx in range(num_experts):
            expert_model = _build_expert_subgraph(
                model,
                moe,
                expert_idx,
                initializer_map,
                value_info_map,
                opset_imports,
            )
            expert_dir = output_dir / f"layer_{layer_idx:03d}"
            expert_dir.mkdir(parents=True, exist_ok=True)
            expert_path = expert_dir / f"expert_{expert_idx:04d}.onnx"
            onnx.save(expert_model, str(expert_path))
            expert_paths[(layer_idx, expert_idx)] = expert_path

    return expert_paths


def _build_expert_subgraph(
    model: ModelProto,
    moe: MoEOpInfo,
    expert_idx: int,
    initializer_map: Dict[str, TensorProto],
    value_info_map: Dict[str, ValueInfoProto],
    opset_imports: List[onnx.OperatorSetIdProto],
) -> ModelProto:
    hidden_size = moe.hidden_size or 2048

    expert_input = helper.make_tensor_value_info(
        "hidden_states", TensorProto.FLOAT, [-1, hidden_size]
    )
    expert_output = helper.make_tensor_value_info(
        "expert_output", TensorProto.FLOAT, [-1, hidden_size]
    )

    intermediate_size = _infer_intermediate_size(moe, initializer_map)

    nodes: List[NodeProto] = []
    initializers: List[TensorProto] = []

    gate_weight = _find_expert_weight(initializer_map, moe, expert_idx, "gate")
    up_weight = _find_expert_weight(initializer_map, moe, expert_idx, "up")
    down_weight = _find_expert_weight(initializer_map, moe, expert_idx, "down")

    if gate_weight and up_weight and down_weight:
        gate_name = f"expert_{expert_idx}_gate.weight"
        up_name = f"expert_{expert_idx}_up.weight"
        down_name = f"expert_{expert_idx}_down.weight"

        gate_tensor = _make_tensor(gate_name, gate_weight)
        up_tensor = _make_tensor(up_name, up_weight)
        down_tensor = _make_tensor(down_name, down_weight)

        initializers.extend([gate_tensor, up_tensor, down_tensor])

        # SwiGLU: Swish(x @ W_gate) * (x @ W_up)  then  result @ W_down
        gate_proj_out = f"expert_{expert_idx}_gate_out"
        up_proj_out = f"expert_{expert_idx}_up_out"
        act_out = f"expert_{expert_idx}_act_out"
        mul_out = f"expert_{expert_idx}_mul_out"

        nodes.append(
            helper.make_node(
                "MatMul",
                inputs=["hidden_states", gate_name],
                outputs=[gate_proj_out],
                name=f"expert_{expert_idx}_gate_proj",
            )
        )
        nodes.append(
            helper.make_node(
                "MatMul",
                inputs=["hidden_states", up_name],
                outputs=[up_proj_out],
                name=f"expert_{expert_idx}_up_proj",
            )
        )

        activation = moe.activation_type.lower()
        if activation == "silu" or activation == "swish":
            nodes.append(
                helper.make_node(
                    "Sigmoid",
                    inputs=[gate_proj_out],
                    outputs=[act_out],
                    name=f"expert_{expert_idx}_silu",
                )
            )
        elif activation == "gelu":
            nodes.append(
                helper.make_node(
                    "Gelu",
                    inputs=[gate_proj_out],
                    outputs=[act_out],
                    name=f"expert_{expert_idx}_gelu",
                )
            )
        elif activation == "relu":
            nodes.append(
                helper.make_node(
                    "Relu",
                    inputs=[gate_proj_out],
                    outputs=[act_out],
                    name=f"expert_{expert_idx}_relu",
                )
            )
        else:
            nodes.append(
                helper.make_node(
                    "Sigmoid",
                    inputs=[gate_proj_out],
                    outputs=[act_out],
                    name=f"expert_{expert_idx}_silu",
                )
            )

        nodes.append(
            helper.make_node(
                "Mul",
                inputs=[act_out, up_proj_out],
                outputs=[mul_out],
                name=f"expert_{expert_idx}_mul",
            )
        )
        nodes.append(
            helper.make_node(
                "MatMul",
                inputs=[mul_out, down_name],
                outputs=["expert_output"],
                name=f"expert_{expert_idx}_down_proj",
            )
        )

    else:
        nodes.append(
            helper.make_node(
                "Identity",
                inputs=["hidden_states"],
                outputs=["expert_output"],
                name=f"expert_{expert_idx}_identity",
            )
        )

    expert_graph = helper.make_graph(
        nodes=nodes,
        name=f"expert_{expert_idx}",
        inputs=[expert_input],
        outputs=[expert_output],
        initializer=initializers,
    )

    expert_model = helper.make_model(
        expert_graph,
        opset_imports=opset_imports,
        producer_name="flaxia-moe-splitter",
    )
    expert_model.ir_version = onnx.IR_VERSION
    return expert_model


def _infer_intermediate_size(moe: MoEOpInfo, initializer_map: Dict[str, TensorProto]) -> int:
    for name, tensor in moe.expert_weights.items():
        if "up" in name.lower() or "down" in name.lower():
            shape = list(tensor.dims)
            if len(shape) >= 2:
                hidden_size = moe.hidden_size or shape[1]
                if shape[0] != hidden_size:
                    return shape[0]
                return shape[1]
    return moe.hidden_size * 3


def _find_expert_weight(
    initializer_map: Dict[str, TensorProto],
    moe: MoEOpInfo,
    expert_idx: int,
    weight_type: str,
) -> Optional[np.ndarray]:
    node_name = moe.node.name or ""

    candidates = []
    for init_name, tensor in initializer_map.items():
        name_lower = init_name.lower()
        if node_name and node_name not in init_name:
            continue
        if weight_type not in name_lower:
            continue
        if f"expert_{expert_idx}" in name_lower or f"experts.{expert_idx}" in name_lower:
            candidates.append((init_name, tensor))

    if not candidates:
        for init_name, tensor in initializer_map.items():
            name_lower = init_name.lower()
            if node_name and node_name not in init_name:
                continue
            if weight_type not in name_lower:
                continue
            candidates.append((init_name, tensor))

    if candidates:
        sorted_candidates = sorted(candidates, key=lambda x: _tensor_size(x[1]), reverse=True)
        name, tensor = sorted_candidates[0]
        return tensor_proto_to_numpy(tensor)

    return None


def _tensor_size(tensor: TensorProto) -> int:
    shape = list(tensor.dims)
    size = 1
    for d in shape:
        size *= d
    return size


def _make_tensor(name: str, data: np.ndarray) -> TensorProto:
    return helper.make_tensor(
        name=name,
        data_type=TensorProto.FLOAT,
        dims=list(data.shape),
        vals=data.flatten().tolist(),
    )
