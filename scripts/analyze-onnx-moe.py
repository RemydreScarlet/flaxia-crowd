#!/usr/bin/env python3
"""
analyze-onnx-moe.py — ONNX MoEモデル構造解析スクリプト

Usage:
    python analyze-onnx-moe.py <model.onnx> [--output-dir ./analysis_output]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import onnx

import sys
sys.path.insert(0, str(Path(__file__).parent))

from lib.moe_op_detector import detect_moe_ops, infer_model_config, format_model_info


def analyze_model(model_path: str, output_dir: str = "./analysis_output") -> None:
    model_path = Path(model_path)
    output_path = Path(output_dir)

    print(f"Loading model: {model_path}")
    model = onnx.load(str(model_path))

    print(f"IR version: {model.ir_version}")
    print(f"Producer: {model.producer_name} {model.producer_version}")
    print(f"Opset imports:")
    for imp in model.opset_import:
        print(f"  {imp.domain or 'ai.onnx'}: v{imp.version}")

    print(f"\nAnalyzing MoE structure...")
    model_info = infer_model_config(model)
    print(format_model_info(model_info))

    print(f"\nMoE layer details:")
    for i, moe in enumerate(model_info.moe_layers):
        print(f"  Layer {moe.layer_index}:")
        print(f"    Op: {moe.op_type} (domain: {moe.domain})")
        print(f"    Experts: {moe.num_experts}, Top-K: {moe.top_k}")
        print(f"    Hidden: {moe.hidden_size}, Activation: {moe.activation_type}")
        print(f"    Input: {moe.input_hidden}")
        print(f"    Output: {moe.output}")
        print(f"    Router logits: {moe.output_router_logits}")
        weight_count = len(moe.expert_weights)
        print(f"    Expert weights found: {weight_count}")
        if weight_count > 0:
            sample_keys = list(moe.expert_weights.keys())[:5]
            print(f"    Sample weight keys: {sample_keys}")

    moe_ops = detect_moe_ops(model)
    print(f"\nTotal MoE ops detected: {len(moe_ops)}")
    print(f"Total layers: {model_info.num_layers}")
    print(f"Dense layers: {model_info.dense_layer_count}")
    print(f"All MoE layers: {len(model_info.moe_layers)}")

    output_path.mkdir(parents=True, exist_ok=True)

    config_path = output_path / f"{model_path.stem}_config.json"
    config = {
        "model_id": model_info.model_id,
        "num_layers": model_info.num_layers,
        "hidden_size": model_info.hidden_size,
        "num_attention_heads": model_info.num_attention_heads,
        "num_key_value_heads": model_info.num_key_value_heads,
        "vocab_size": model_info.vocab_size,
        "num_expert_layers": len(model_info.moe_layers),
        "dense_layer_count": model_info.dense_layer_count,
        "moe_layers": [
            {
                "layer_index": m.layer_index,
                "op_type": m.op_type,
                "num_experts": m.num_experts,
                "top_k": m.top_k,
                "hidden_size": m.hidden_size,
                "activation_type": m.activation_type,
                "input_hidden": m.input_hidden,
                "output": m.output,
                "output_router_logits": m.output_router_logits,
            }
            for m in model_info.moe_layers
        ],
    }
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"\nConfig saved to: {config_path}")

    info_path = output_path / f"{model_path.stem}_analysis.txt"
    with open(info_path, "w") as f:
        f.write(format_model_info(model_info))
        f.write("\n")
    print(f"Analysis saved to: {info_path}")


def main():
    parser = argparse.ArgumentParser(description="Analyze ONNX MoE model structure")
    parser.add_argument("model", type=str, help="Path to ONNX model file")
    parser.add_argument("--output-dir", type=str, default="./analysis_output",
                        help="Output directory for analysis results")
    args = parser.parse_args()

    analyze_model(args.model, args.output_dir)


if __name__ == "__main__":
    main()
