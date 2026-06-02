"""重みの分類・分割"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class WeightPartition:
    coordinator_weights: Dict[str, Any]
    expert_weights: Dict[str, Dict[str, Any]]  # expert_idx → {gate, up, down}
    model_info: Dict[str, Any]


def split_weights(state_dict: Dict[str, Any], arch) -> WeightPartition:
    ...


def save_coordinator_weights(
    weights: Dict[str, Any], output_dir: Path, dtype: str = "bfloat16"
) -> Path:
    import torch
    from safetensors.torch import save_file

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "model.safetensors"

    tensors = {k: v.contiguous() for k, v in weights.items()}
    save_file(tensors, str(output_path))
    return output_path


def save_expert_weights(
    expert_weights: Dict[str, Dict[str, Any]],
    output_dir: Path,
    dtype: str = "bfloat16",
) -> List[Path]:
    saved_paths = []
    for expert_idx, weights in expert_weights.items():
        expert_dir = output_dir / f"expert_{int(expert_idx):04d}"
        expert_dir.mkdir(parents=True, exist_ok=True)

        tensors = {k: v.contiguous() for k, v in weights.items()}
        output_path = expert_dir / "model.safetensors"
        from safetensors.torch import save_file

        save_file(tensors, str(output_path))
        saved_paths.append(output_path)

    return saved_paths
