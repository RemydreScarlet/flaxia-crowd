"""PyTorch MoEモデルロード・構造解析"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class MoELayerInfo:
    layer_index: int
    num_experts: int
    top_k: int
    hidden_size: int
    intermediate_size: int
    activation: str
    is_hash_routed: bool
    has_shared_expert: bool
    compress_ratio: int  # CSA: 0=dense
    expert_weight_keys: List[str]
    router_weight_keys: List[str]
    shared_expert_weight_keys: List[str]


@dataclass
class ModelArchitecture:
    model_id: str
    num_layers: int
    hidden_size: int
    num_attention_heads: int
    num_key_value_heads: int
    head_dim: int
    vocab_size: int
    max_position_embeddings: int
    moe_layers: List[MoELayerInfo]
    num_hash_layers: int
    has_shared_expert: bool
    has_mtp: bool
    activation: str
    dtype: str
    total_params: int
    active_params: int


def load_config(model_dir: Path) -> Dict[str, Any]:
    import json
    config_path = model_dir / "config.json"
    if not config_path.exists():
        raise FileNotFoundError(f"config.json not found: {config_path}")
    with open(config_path) as f:
        return json.load(f)


def parse_config(config: Dict[str, Any]) -> ModelArchitecture:
    ...


def load_checkpoint(model_dir: Path) -> Dict[str, Any]:
    from safetensors.torch import load_file

    safetensors_paths = list(model_dir.glob("*.safetensors"))
    if not safetensors_paths:
        raise FileNotFoundError(f"No .safetensors files in {model_dir}")

    state_dict = {}
    for path in safetensors_paths:
        state_dict.update(load_file(str(path)))
    return state_dict


def classify_weights(state_dict: Dict[str, Any], arch: ModelArchitecture):
    ...


def detect_deepseek_v4_arch(config: Dict[str, Any]) -> ModelArchitecture:
    ...
