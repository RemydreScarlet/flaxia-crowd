"""Coordinatorモデル構築・ONNXエクスポート"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional


def build_coordinator_model(
    weights: Dict[str, Any],
    config: Dict[str, Any],
    output_path: Path,
    dtype: str = "bfloat16",
):
    ...


def export_coordinator_onnx(
    output_dir: Path, opset: int = 21, dynamic_axes: bool = True
) -> Path:
    ...
