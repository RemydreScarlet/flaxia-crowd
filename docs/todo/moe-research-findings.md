# MoE 分散推論 文献調査・技術調査 報告書

調査日: 2026-06-02 (更新: DeepSeek-V4-Flash 対応)

## 1. 分散MoE推論システム 先行研究

### 1.1 Petals (2022-2023, NeurIPS 2023)
**論文**: https://arxiv.org/abs/2209.01188
- P2Pパイプラインモデル並列。コンシューマGPUでBLOOM-176Bが~1 step/sec。
- **flaxiaへの示唆**: MoEにおけるパイプライン並列の基本設計として参考。ただしflaxiaはブラウザベース。

### 1.2 Prism (arXiv 2508.12851, Apr 2026)
**論文**: https://arxiv.org/abs/2508.12851
- Activation-Aware Expert Placement: エキスパート活性化パターンのエントロピーに基づく配置
- DeepSeek-V2-Liteでレイテンシ最大30.6%削減
- **flaxiaへの示唆**: 発見「Expert活性化パターンはタスクに強く依存し安定」はSpeculative Dispatchに応用可能

### 1.3 Speculative MoE (ICML 2025)
**論文**: https://arxiv.org/abs/2503.04398
- Speculative Token Shuffling: 将来トークンのルーティングパスを予測し事前転送
- all-to-all通信量削減
- **flaxiaへの示唆**: ブラウザ環境では通信が特に遅い。Speculative Dispatchが有効

### 1.4 Semantic Parallelism (ICLR 2026)
- 同時活性化されやすいExpertを同一デバイスに配置
- **flaxiaへの示唆**: V4-Flashの256 Expertを複数ノードに配置する際の参考

### 1.5 MoBiLE (ASP-DAC 2026)
- トークン重要度に応じて活性化Expert数を動的変更
- **flaxiaへの示唆**: 帯域幅制約下で有効。V4-Flashではtop-7中いくつをスキップできるか検討

## 2. DeepSeek-V4-Flash 詳細パラメータ

### アーキテクチャ概要

| コンポーネント | 仕様 |
|---------------|------|
| 総パラメータ | 284B |
| 活性化パラメータ/トークン | 13B |
| 層数 | 60 (うち2層 hash-routed + 58層 MoE) |
| Attention | MQA (1 KV head), head_dim=128, 24 heads |
| Hybrid Attention | CSA (Compressed Sparse) + HCA (Heavily Compressed) |
| compress_ratios | [0,0,4,112,... ,4,0] (層ごとに異なる圧縮率) |
| mHC | Manifold-Constrained Hyper-Connections (4-stream) |
| ルーティング | sqrt(softplus) + expert bias |
| Routed Experts | 256 (active top-7) |
| Shared Expert | 1 (常に活性化) |
| moe_intermediate_size | 1536 |
| 活性化関数 | clamped SwiGLU |
| Hash-routed layers | 最初の2層 |
| MTP | 1 head |
| YaRN | factor=16, max_position=1,048,576 |
| vocab_size | 129280 |

### Expert重み構造

各routed expertは3つの重みを持つ:
- `experts.{expert_idx}.gate.weight`: [intermediate_size, hidden_size] = [1536, 3072]
- `experts.{expert_idx}.up.weight`: [intermediate_size, hidden_size] = [1536, 3072]
- `experts.{expert_idx}.down.weight`: [hidden_size, intermediate_size] = [3072, 1536]

1 Expertあたり: 1536 × 3072 × 3 ≈ 13.5M パラメータ → ~27MB (fp16) / ~6.75MB (int4)
58層で展開: 58 × 256 × 13.5M ≈ 200B パラメータ（全体の大部分）

## 3. ファイル分割 + ONNXエクスポート戦略

### 3.1 なぜONNXグラフ操作ではないのか

**従来アプローチ（却下）**:
```
model.onnx → QMoE op解析 → サブグラフ抽出 → coordinator + expert onnx
```
課題: QMoEカスタムopの内部構造が不透明。モデルごとに調整が必要。

**新アプローチ（採用）**:
```
model.safetensors (PyTorch)
  → 重み分類 (Coordinator / Expert)
  → 個別ファイル + ONNXエクスポート
```

### 3.2 PyTorch → ONNX 変換の要点

**Coordinatorモデル**:
- 入力: input_ids (int64)
- 出力: logits (float), router_logits (float), expert_indices (int64)
- 内部: Embedding + MQA Attention + CSA/HCA + mHC + Shared Expert FFN + Router + OutputHead

**Expertモデル**:
- 入力: hidden_states (float, [-1, 3072])
- 出力: expert_output (float, [-1, 3072])
- 内部: MatMul(Gate) → SiLU → MatMul(Up) → Mul → MatMul(Down)

### 3.3 量子化戦略

| モデル | dtypes |
|--------|--------|
| Coordinator | int8 (主要部) / fp16 (Router) |
| Expert Worker | int4 (専門家重みのみ) |
| 通信転送 | fp16 → int8 |

### 3.4 Transformers.js v5 連携

HuggingFace Transformers.js v5 では Expert Parallelism をネイティブサポート。
`enable_expert_parallel: true` で Coordinator/Expert の分離実行が可能。

flaxia はこれをラップし、Expert実行部分を：
1. 同一タブの Web Worker (Phase 1-B)
2. リモートブラウザノード (Phase 2-3)

に切り替え可能にする。

## 4. 通信最適化

### 4.1 V4-Flash通信量詳細

| 項目 | 値 |
|------|-----|
| hidden_size | 3072 |
| 1 Expert送信 (fp16) | 3072 × 2 = 6KB |
| 1層あたり (top-7) | 7 × 6KB = 43KB (送信), 43KB (受信) |
| Shared Expert | 6KB (送), 6KB (受) — Coordinator内完結のため通信不要 |
| 58 MoE層 合計 | ~5.7MB/token |
| バッチ4 | ~25.6MB/token step |
| 100Mbpsリンク (逐次) | ~460ms/token |
| パイプライン+バッチ | ~30ms/token (推定) |

### 4.2 リスクと対策

| リスク | 対策 |
|--------|------|
| Coordinator ~3.6GB (bf16) → ブラウザメモリ超過 | int8量子化で~1.8GBに削減 |
| 256 Expert 全カバーには多数ノード必要 | 動的ロード/アンロード + キャッシュ |
| 58層 × 7 = 406回/トークンの通信 | Speculative Dispatch + バッチ処理 |
| Expertノード離脱 | グレースフルデグラデーション (top-7→top-6) |

## 5. 参考文献

1. DeepSeek-V4 Technical Report (arXiv, Apr 2026)
2. Prism: Accelerating Edge Inference for Distributed MoE Models (arXiv:2508.12851, 2026)
3. Speculative MoE (ICML 2025) - arXiv:2503.04398
4. Semantic Parallelism (ICLR 2026)
5. Petals (NeurIPS 2023) - arXiv:2209.01188
6. HuggingFace Transformers v5 — Expert Parallelism / WeightConverter
7. MoBiLE (ASP-DAC 2026)
8. MoE-Infinity + Lynx
9. VELA (ICDCS 2025)
10. A Survey on Inference Optimization for MoE Models (arXiv:2412.14219, 2024)
