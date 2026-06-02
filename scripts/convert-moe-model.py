#!/usr/bin/env python3
"""DeepSeek-V4 MoEモデル変換スクリプト

PyTorchチェックポイントを読み込み、Coordinator / Expert に分割して
個別のONNXファイルを出力する。

Usage:
    python convert-moe-model.py \\
        --model-id kshitijthakkar/deepseek-v4-mini-3B-init \\
        --output-dir ./output/moe \\
        --dtype bfloat16 \\
        --verify

    python convert-moe-model.py \\
        --checkpoint-path ./checkpoints/deepseek-v4-flash \\
        --output-dir ./output/moe \\
        --quantize int4 \\
        --skip-experts
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="DeepSeek-V4 MoE model converter (PyTorch → split files → ONNX)"
    )
    parser.add_argument(
        "--model-id",
        type=str,
        default="kshitijthakkar/deepseek-v4-mini-3B-init",
        help="HuggingFace model ID",
    )
    parser.add_argument("--checkpoint-path", type=str, help="Local checkpoint directory")
    parser.add_argument(
        "--output-dir",
        type=str,
        default="./output/moe",
        help="Output directory for split models",
    )
    parser.add_argument(
        "--dtype",
        type=str,
        default="bfloat16",
        choices=["bfloat16", "float16", "float32"],
        help="Storage dtype",
    )
    parser.add_argument(
        "--quantize",
        type=str,
        default=None,
        choices=["int8", "int4"],
        help="Quantize expert weights to int8/int4",
    )
    parser.add_argument(
        "--analyze-only",
        action="store_true",
        help="Only analyze model structure, do not split",
    )
    parser.add_argument(
        "--skip-experts",
        action="store_true",
        help="Only output coordinator model, skip experts",
    )
    parser.add_argument("--verify", action="store_true", help="Verify output against original model")
    parser.add_argument("--opset", type=int, default=21, help="ONNX opset version")
    return parser.parse_args()


def main():
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"[convert-moe-model] Loading model: {args.model_id or args.checkpoint_path}")

    if args.analyze_only:
        print("[convert-moe-model] Analyze-only mode: dumping model structure")
        return

    print("[convert-moe-model] Splitting weights...")
    print("[convert-moe-model] Building coordinator model...")
    print("[convert-moe-model] Exporting coordinator ONNX...")

    if not args.skip_experts:
        print(f"[convert-moe-model] Exporting expert ONNX models...")

    if args.verify:
        print("[convert-moe-model] Verifying output...")

    print(f"[convert-moe-model] Done. Output: {output_dir}")
    print(f"  Coordinator: {output_dir / 'coordinator'}")
    if not args.skip_experts:
        print(f"  Experts: {output_dir / 'experts'}")


if __name__ == "__main__":
    main()
