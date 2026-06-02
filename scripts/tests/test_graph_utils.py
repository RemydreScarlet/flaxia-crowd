import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

import onnx
from onnx import helper, TensorProto
import numpy as np

from lib.onnx_graph_utils import (
    build_node_map,
    build_output_to_node,
    build_initializer_map,
    tensor_proto_to_numpy,
    extract_subgraph,
)


def _make_test_model():
    X = helper.make_tensor_value_info("X", TensorProto.FLOAT, [1, 4])
    W = helper.make_tensor_value_info("W", TensorProto.FLOAT, [4, 4])
    Y = helper.make_tensor_value_info("Y", TensorProto.FLOAT, [1, 4])

    w_init = helper.make_tensor("W", TensorProto.FLOAT, [4, 4],
                                np.random.randn(16).tolist())

    matmul = helper.make_node("MatMul", ["X", "W"], ["Z"], name="matmul")
    relu = helper.make_node("Relu", ["Z"], ["Y"], name="relu")

    graph = helper.make_graph(
        nodes=[matmul, relu],
        name="test_graph",
        inputs=[X, W],
        outputs=[Y],
        initializer=[w_init],
    )
    opsets = [helper.make_opsetid("", 21)]
    model = helper.make_model(graph, opset_imports=opsets)
    return model


class TestGraphUtils(unittest.TestCase):
    def setUp(self):
        self.model = _make_test_model()

    def test_build_node_map(self):
        node_map = build_node_map(self.model.graph)
        self.assertIn("matmul", node_map)
        self.assertIn("relu", node_map)
        self.assertEqual(len(node_map), 2)

    def test_build_output_to_node(self):
        mapping = build_output_to_node(self.model.graph)
        self.assertIn("Z", mapping)
        self.assertIn("Y", mapping)
        self.assertEqual(mapping["Z"].op_type, "MatMul")
        self.assertEqual(mapping["Y"].op_type, "Relu")

    def test_build_initializer_map(self):
        init_map = build_initializer_map(self.model.graph)
        self.assertIn("W", init_map)

    def test_tensor_proto_to_numpy(self):
        init_map = build_initializer_map(self.model.graph)
        w = init_map["W"]
        arr = tensor_proto_to_numpy(w)
        self.assertEqual(arr.shape, (4, 4))
        self.assertEqual(arr.dtype, np.float32)

    def test_extract_subgraph(self):
        partition = extract_subgraph(self.model.graph, ["Y"])
        self.assertGreater(len(partition.nodes), 0)
        node_names = [n.name for n in partition.nodes]
        self.assertIn("relu", node_names)
        self.assertIn("matmul", node_names)


if __name__ == "__main__":
    unittest.main()
