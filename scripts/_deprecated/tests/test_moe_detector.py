import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib.moe_op_detector import (
    MoEOpInfo,
    MoEModelInfo,
    KNOWN_MOE_OPS,
)


class TestMoEConstants(unittest.TestCase):
    def test_known_ops(self):
        self.assertIn("QMoE", KNOWN_MOE_OPS)
        self.assertIn("MoE", KNOWN_MOE_OPS)

    def test_moe_op_info_defaults(self):
        import onnx
        from onnx import helper

        node = helper.make_node("QMoE", inputs=["h", "w"], outputs=["out"], name="test_moe")
        info = MoEOpInfo(
            node=node,
            op_type="QMoE",
            domain="com.microsoft",
            layer_index=0,
            num_experts=64,
            top_k=8,
            hidden_size=2048,
            activation_type="silu",
            norm_type="none",
            input_hidden="h",
            input_router_weights="w",
            output="out",
            output_router_logits="router_logits",
        )
        self.assertEqual(info.num_experts, 64)
        self.assertEqual(info.top_k, 8)
        self.assertEqual(info.hidden_size, 2048)
        self.assertEqual(info.activation_type, "silu")

    def test_model_info_defaults(self):
        info = MoEModelInfo(
            model_id="test",
            num_layers=48,
            hidden_size=2048,
            num_attention_heads=16,
            num_key_value_heads=4,
            vocab_size=151936,
            moe_layers=[],
            dense_layer_count=0,
        )
        self.assertEqual(info.num_layers, 48)
        self.assertEqual(info.hidden_size, 2048)
        # Qwen3-30B-A3B defaults
        self.assertEqual(info.vocab_size, 151936)


class TestKNOWN_MOE_OPS(unittest.TestCase):
    def test_qmoe_in_set(self):
        self.assertIn("QMoE", KNOWN_MOE_OPS)

    def test_moe_in_set(self):
        self.assertIn("MoE", KNOWN_MOE_OPS)


if __name__ == "__main__":
    unittest.main()
