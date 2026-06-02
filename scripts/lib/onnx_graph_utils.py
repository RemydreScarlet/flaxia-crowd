from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import numpy as np
import onnx
from onnx import ModelProto, NodeProto, TensorProto, ValueInfoProto, helper


@dataclass
class NodeEdge:
    node: NodeProto
    input_names: List[str]
    output_names: List[str]


@dataclass
class GraphPartition:
    nodes: List[NodeProto]
    inputs: List[ValueInfoProto]
    outputs: List[ValueInfoProto]
    initializers: List[TensorProto]


def build_node_map(graph: onnx.GraphProto) -> Dict[str, NodeProto]:
    return {n.name: n for n in graph.node if n.name}


def build_output_to_node(graph: onnx.GraphProto) -> Dict[str, NodeProto]:
    mapping: Dict[str, NodeProto] = {}
    for node in graph.node:
        for output in node.output:
            if output:
                mapping[output] = node
    return mapping


def build_value_info_map(graph: onnx.GraphProto) -> Dict[str, ValueInfoProto]:
    mapping: Dict[str, ValueInfoProto] = {}
    for v in graph.input:
        mapping[v.name] = v
    for v in graph.output:
        mapping[v.name] = v
    for v in graph.value_info:
        mapping[v.name] = v
    return mapping


def build_initializer_map(graph: onnx.GraphProto) -> Dict[str, TensorProto]:
    return {t.name: t for t in graph.initializer}


def get_tensor_shape(tensor: TensorProto) -> List[int]:
    dims = tensor.dims
    return list(dims)


def tensor_proto_to_numpy(tensor: TensorProto) -> np.ndarray:
    shape = get_tensor_shape(tensor)

    if tensor.raw_data:
        elem_type = tensor.data_type
        dtype_map = {
            TensorProto.FLOAT: np.float32,
            TensorProto.FLOAT16: np.float16,
            TensorProto.DOUBLE: np.float64,
            TensorProto.INT32: np.int32,
            TensorProto.INT64: np.int64,
            TensorProto.INT8: np.int8,
            TensorProto.UINT8: np.uint8,
            TensorProto.BFLOAT16: np.uint16,
        }
        np_dtype = dtype_map.get(elem_type, np.float32)
        return np.frombuffer(tensor.raw_data, dtype=np_dtype).reshape(shape).copy()

    if tensor.data_type == TensorProto.FLOAT and tensor.float_data:
        return np.array(list(tensor.float_data), dtype=np.float32).reshape(shape).copy()
    if tensor.data_type == TensorProto.INT64 and tensor.int64_data:
        return np.array(list(tensor.int64_data), dtype=np.int64).reshape(shape).copy()
    if tensor.data_type == TensorProto.INT32 and tensor.int32_data:
        return np.array(list(tensor.int32_data), dtype=np.int32).reshape(shape).copy()

    return np.zeros(shape, dtype=np.float32)


def trace_predecessors(
    graph: onnx.GraphProto,
    target_output: str,
    stop_at_nodes: Optional[Set[str]] = None,
) -> Tuple[Set[str], List[NodeProto]]:
    output_to_node = build_output_to_node(graph)
    visited_nodes: Set[str] = set()
    visited_tensors: Set[str] = set()
    queue = [target_output]

    while queue:
        tensor = queue.pop(0)
        if tensor in visited_tensors:
            continue
        visited_tensors.add(tensor)

        node = output_to_node.get(tensor)
        if node is None:
            continue
        if node.name in visited_nodes:
            continue
        if stop_at_nodes and node.name in stop_at_nodes:
            continue
        visited_nodes.add(node.name)

        for inp in node.input:
            if inp and inp not in visited_tensors:
                queue.append(inp)

    result_nodes = [n for n in graph.node if n.name in visited_nodes]
    return visited_tensors, result_nodes


def extract_subgraph(
    graph: onnx.GraphProto,
    target_outputs: List[str],
    stop_at_nodes: Optional[Set[str]] = None,
) -> GraphPartition:
    all_tensors: Set[str] = set()
    all_nodes: Set[str] = set()

    for out_name in target_outputs:
        tensors, nodes = trace_predecessors(graph, out_name, stop_at_nodes)
        all_tensors.update(tensors)
        all_nodes.update(n.name for n in nodes)

    initializer_map = build_initializer_map(graph)
    value_info_map = build_value_info_map(graph)

    sub_nodes = [n for n in graph.node if n.name in all_nodes]
    sub_initializers = [init for name, init in initializer_map.items() if name in all_tensors]

    consumed_tensors: Set[str] = set()
    produced_tensors: Set[str] = set()
    for n in sub_nodes:
        for inp in n.input:
            if inp:
                consumed_tensors.add(inp)
        for out in n.output:
            if out:
                produced_tensors.add(out)

    missing_inputs = consumed_tensors - produced_tensors - {t for t in all_tensors if t in initializer_map}
    missing_inputs -= set(target_outputs)

    sub_inputs: List[ValueInfoProto] = []
    available_vis = {v.name: v for v in graph.input}
    available_vis.update({v.name: v for v in graph.value_info})

    for inp in graph.input:
        if inp.name in all_tensors:
            sub_inputs.append(inp)

    for name in sorted(missing_inputs):
        if name not in {vi.name for vi in sub_inputs}:
            vi = available_vis.get(name)
            if vi:
                sub_inputs.append(vi)
            else:
                sub_inputs.append(helper.make_tensor_value_info(name, TensorProto.FLOAT, []))

    sub_outputs: List[ValueInfoProto] = []
    for out_name in target_outputs:
        if out_name in value_info_map:
            sub_outputs.append(value_info_map[out_name])
        else:
            sub_outputs.append(helper.make_tensor_value_info(out_name, TensorProto.FLOAT, []))

    return GraphPartition(
        nodes=sub_nodes,
        inputs=sub_inputs,
        outputs=sub_outputs,
        initializers=sub_initializers,
    )


def make_model_from_partition(
    partition: GraphPartition,
    opset_imports: List[onnx.OperatorSetIdProto],
    model_name: str = "subgraph",
    producer: str = "flaxia-moe-splitter",
) -> ModelProto:
    graph = helper.make_graph(
        nodes=partition.nodes,
        name=model_name,
        inputs=partition.inputs,
        outputs=partition.outputs,
        initializer=partition.initializers,
    )
    model = helper.make_model(graph, opset_imports=opset_imports, producer_name=producer)
    model.ir_version = onnx.IR_VERSION
    return model


def rename_node_outputs(node: NodeProto, suffix: str) -> NodeProto:
    new_node = helper.make_node(
        node.op_type,
        inputs=list(node.input),
        outputs=[f"{o}_{suffix}" if o else o for o in node.output],
        name=f"{node.name}_{suffix}" if node.name else "",
        domain=node.domain,
    )
    for attr in node.attribute:
        new_node.attribute.append(attr)
    return new_node


def save_model(model: ModelProto, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(path))
