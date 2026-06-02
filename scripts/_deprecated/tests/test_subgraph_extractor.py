import unittest
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).parent.parent))

import onnx
from onnx import helper, TensorProto
import numpy as np

from lib.subgraph_extractor import (
    split_for_coordinator,
    split_for_experts,
)
from lib.moe_op_detector import infer_model_config


def _make_mock_moe_model():
    hidden_size = 64
    num_experts = 8
    top_k = 2
    seq_len = 4

    X = helper.make_tensor_value_info("input_ids", TensorProto.INT64, [1, seq_len])
    Y = helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, seq_len, hidden_size])

    nodes = []

    embed_weight = helper.make_tensor(
        "embed.weight", TensorProto.FLOAT, [100, hidden_size],
        np.random.randn(100 * hidden_size).tolist(),
    )

    nodes.append(helper.make_node(
        "Gather", ["embed.weight", "input_ids"], ["hidden_0"],
        name="embedding", axis=0,
    ))

    for layer_idx in range(4):
        inp_name = f"hidden_{layer_idx}"
        attn_out = f"hidden_attn_{layer_idx}"
        moe_out = f"hidden_{layer_idx + 1}"

        nodes.append(helper.make_node(
            "Identity", [inp_name], [attn_out],
            name=f"attention_{layer_idx}",
        ))

        nodes.append(helper.make_node(
            "QMoE", [attn_out], [moe_out, f"router_logits_{layer_idx}"],
            name=f"moe_layer_{layer_idx}",
            domain="com.microsoft",
            num_experts=num_experts,
            k=top_k,
            hidden_size=hidden_size,
            activation_type=b"silu",
        ))

    # Add output projection to connect to graph output
    nodes.append(helper.make_node(
        "Identity", [f"hidden_{4}"], ["logits"],
        name="output_proj",
    ))

    initializers = [embed_weight]

    graph = helper.make_graph(
        nodes=nodes,
        name="mock_moe",
        inputs=[X],
        outputs=[Y],
        initializer=initializers,
    )
    opsets = [
        helper.make_opsetid("", 21),
        helper.make_opsetid("com.microsoft", 1),
    ]
    model = helper.make_model(graph, opset_imports=opsets, producer_name="test")
    model.ir_version = onnx.IR_VERSION
    return model


class TestSubgraphExtractor(unittest.TestCase):
    def setUp(self):
        self.model = _make_mock_moe_model()
        self.model_info = infer_model_config(self.model)

    def test_model_info_detected(self):
        self.assertGreater(len(self.model_info.moe_layers), 0)
        self.assertEqual(self.model_info.moe_layers[0].num_experts, 8)
        self.assertEqual(self.model_info.moe_layers[0].top_k, 2)
        self.assertEqual(self.model_info.moe_layers[0].hidden_size, 64)

    def test_split_coordinator(self):
        coord_model = split_for_coordinator(self.model, self.model_info)
        self.assertIsNotNone(coord_model)
        graph = coord_model.graph

        node_names = [n.name for n in graph.node]
        self.assertIn("output_proj", node_names)

        self.assertGreater(len(graph.output), 0)
        output_names = [o.name for o in graph.output]
        self.assertIn("logits", output_names)
        has_router_logits = any("router_logits" in o.name for o in graph.output)
        self.assertTrue(has_router_logits)

    def test_split_experts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            expert_paths = split_for_experts(
                self.model, self.model_info, output_dir
            )

            self.assertGreater(len(expert_paths), 0)

            for (layer_idx, expert_idx), path in expert_paths.items():
                self.assertTrue(path.exists(), f"Expert file not found: {path}")
                expert_model = onnx.load(str(path))
                graph = expert_model.graph
                self.assertEqual(len(graph.input), 1)
                self.assertEqual(len(graph.output), 1)
                self.assertEqual(graph.input[0].name, "hidden_states")
                self.assertEqual(graph.output[0].name, "expert_output")


if __name__ == "__main__":
    unittest.main()
