#!/usr/bin/env python3
"""
split-onnx-moe.py — ONNX MoEモデル分割スクリプト

MoEモデルを Coordinator (Attention + Router) と
個別 Expert FFN サブグラフに分割する。

Usage:
    python split-onnx-moe.py <model.onnx> --output-dir ./output/moe/qwen3
    python split-onnx-moe.py <model.onnx> --analyze-only
    python split-onnx-moe.py <model.onnx> --skip-experts  # Coordinatorのみ
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import onnx
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from lib.moe_op_detector import (
    MoEModelInfo,
    detect_moe_ops,
    infer_model_config,
    format_model_info,
)
from lib.onnx_graph_utils import (
    build_initializer_map,
    build_node_map,
    save_model,
)
from lib.subgraph_extractor import (
    split_for_coordinator,
    split_for_experts,
)


def split_model(
    model_path: str,
    output_dir: str = "./output/moe/split",
    analyze_only: bool = False,
    skip_experts: bool = False,
) -> MoEModelInfo:
    model_path_obj = Path(model_path)
    output_path = Path(output_dir)

    print(f"Loading model: {model_path_obj}")
    model = onnx.load(str(model_path_obj))

    print("Analyzing MoE structure...")
    model_info = infer_model_config(model)
    print(format_model_info(model_info))

    model_name = model_path_obj.stem
    model_output_dir = output_path / model_name
    coord_output_dir = model_output_dir / "coordinator"
    experts_output_dir = model_output_dir / "experts"

    if analyze_only:
        config_path = model_output_dir / f"{model_name}_config.json"
        model_output_dir.mkdir(parents=True, exist_ok=True)
        _save_config(model_info, config_path)
        print(f"\nConfig saved to: {config_path}")
        return model_info

    coord_output_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n[1/2] Extracting coordinator subgraph...")
    coord_model = split_for_coordinator(model, model_info)
    coord_path = coord_output_dir / "coordinator.onnx"
    save_model(coord_model, coord_path)
    print(f"  Coordinator model saved: {coord_path}")
    print(f"  Nodes: {len(coord_model.graph.node)}")
    print(f"  Inputs: {[i.name for i in coord_model.graph.input]}")
    print(f"  Outputs: {[o.name for o in coord_model.graph.output]}")

    if not skip_experts and model_info.moe_layers:
        print(f"\n[2/2] Extracting expert subgraphs...")
        experts_output_dir.mkdir(parents=True, exist_ok=True)
        expert_paths = split_for_experts(model, model_info, experts_output_dir)

        total = len(expert_paths)
        print(f"  Extracted {total} expert subgraphs")

        layer_summary: Dict[int, int] = {}
        for (layer_idx, expert_idx), path in expert_paths.items():
            layer_summary[layer_idx] = layer_summary.get(layer_idx, 0) + 1

        for layer_idx in sorted(layer_summary.keys()):
            count = layer_summary[layer_idx]
            print(f"    Layer {layer_idx}: {count} experts ({experts_output_dir / f'layer_{layer_idx:03d}'}/)")

    config_path = model_output_dir / f"{model_name}_config.json"
    _save_config(model_info, config_path)
    print(f"\nConfig saved: {config_path}")
    print(f"Output directory: {model_output_dir}")
    print("Done.")

    return model_info


def _save_config(model_info: MoEModelInfo, config_path: Path) -> None:
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
                "norm_type": m.norm_type,
                "input_hidden": m.input_hidden,
                "output": m.output,
                "output_router_logits": m.output_router_logits,
            }
            for m in model_info.moe_layers
        ],
    }
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Split ONNX MoE model into coordinator + experts")
    parser.add_argument("model", type=str, help="Path to ONNX model file")
    parser.add_argument("--output-dir", type=str, default="./output/moe/split",
                        help="Output directory")
    parser.add_argument("--analyze-only", action="store_true",
                        help="Only analyze, don't split")
    parser.add_argument("--skip-experts", action="store_true",
                        help="Skip expert extraction (coordinator only)")
    args = parser.parse_args()

    split_model(
        model_path=args.model,
        output_dir=args.output_dir,
        analyze_only=args.analyze_only,
        skip_experts=args.skip_experts,
    )


if __name__ == "__main__":
    main()
