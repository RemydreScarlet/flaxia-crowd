"""Expert ONNXモデル構築（SwiGLU FFN）"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional


def build_expert_onnx(
    expert_idx: int,
    gate_weight: Any,
    up_weight: Any,
    down_weight: Any,
    hidden_size: int,
    intermediate_size: int,
    activation: str = "silu",
    output_dir: Optional[Path] = None,
    opset: int = 21,
) -> bytes:
    ...


def export_all_experts(
    expert_weights_map: Dict[str, Dict[str, Any]],
    hidden_size: int,
    intermediate_size: int,
    output_dir: Path,
    activation: str = "silu",
    opset: int = 21,
) -> Dict[str, Path]:
    ...
