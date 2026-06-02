# MoE (Mixture of Experts) 分散推論 全体計画

## 目標

flaxia-crowd の分散ノード網を活用し、MoEモデルのエキスパートFFN層を複数ブラウザノードに分散配置。
Coordinatorノードが Attention + Router を担当し、Expert Workerノードが FFN 計算を担当することで、
単一ブラウザでは載らない大規模MoEモデル (30B-A3B 等) の推論を実現する。

## アーキテクチャ比較: 3つの分散戦略

### 戦略A: エキスパート並列 (EP, 元提案 / 先行研究: vLLM・Speculative MoE)
```
Coordinator (Attention + Router + Embedding + OutputHead)
  │ 全48層で各層ごとに8エキスパートにhidden_state配送
  ▼
Worker A ─ Worker B ─ Worker C ... (各Workerが1-2 Expert FFN保持)
```
- ✅ メモリ効率最良 (非Expert部 ~700MB, Expert部 ~224MB/ノード)
- ❌ **全48層 × 8 = 384回/トークンの通信** (3MB/token)
- ❌ 同期的: 全Expertの結果到着を待つ必要あり

### 戦略B: パイプライン並列 (先行研究: Petals)
```
Worker A (Layer 0-11) → Worker B (Layer 12-23) → Worker C (Layer 24-35) → Worker D (Layer 36-47)
  (各ノードが層単位で担当 + 全Expertも保持)
```
- ✅ 通信回数層境界のみ (4回/トークン)
- ❌ メモリ不均衡 (各ノード ~8B分の全重み)

### 戦略C: ハイブリッド (Attention全保持 + Expert分散。先行研究: Prism)
```
各ノード: Attention全層 + 一部Expert
  Worker A: Expert 1-32 (ローカルホットセット)
  Worker B: Expert 33-64
  Worker C: Expert 65-96
  Worker D: Expert 97-128
```
- ✅ ローカル実行比率最大化 (リモート呼出最小)
- ✅ Prismの活性化パターン分析を応用可能
- ❌ メモリ要件 ~6GB/ノード (ブラウザには重い)

### 採用: 戦略A (元提案) + Speculative最適化
- メモリ制約の強いブラウザ環境に最適
- Speculative MoEの手法で通信削減 (予測ベース事前転送)
- Phase 3でバッチ処理・差分転送を追加

## Qwen3-30B-A3B パラメータ詳細

| 項目 | 値 |
|------|-----|
| vocab_size | 151936 |
| hidden_size | 2048 |
| intermediate_size | 6144 |
| num_hidden_layers | 48 |
| num_attention_heads | 16 |
| num_key_value_heads | 4 (GQA) |
| num_experts | 128 |
| num_top_k | 8 |
| MoE層 | 全48層 (dense FFN無し) |
| コンテキスト長 | 32K (YaRNで131K) |

出典: HuggingFace Qwen3MoeConfig / Qwen3 Technical Report (arXiv:2505.09388)

### メモリ試算 (Q4量子化)

| コンポーネント | パラメータ量 | 計算 | Q4換算 |
|---|---|---|---|
| Embedding | 311M | 151936 × 2048 | ~156MB |
| Attention(48層) | 792M | 48 × ((2048×2048×3)+(2048×2048)) | ~396MB |
| Router(48層) | 12.6M | 48 × 2048 × 128 | ~6.3MB |
| OutputHead | 311M | 2048 × 151936 | ~156MB |
| **Coordinator計** | **~1.43B** | | **~715MB** |
| Expert 1個(48層) | 432M | 48 × 2 × 2048 × 6144 / 128 | ~216MB |
| **Expert 8個** | **~3.46B** | | **~1.73GB** |

## 通信量試算 (1トークンあたり)

| 項目 | 値 |
|------|-----|
| 1 Layerあたりの送信 | 8 experts × 2048 × 2bytes = 32KB |
| 1 Layerあたりの受信 | 8 experts × 2048 × 2bytes = 32KB |
| 1 Layerあたり合計 | 64KB |
| 全48層 | **~3MB/token** |
| バッチ4トークン | **~12MB/token step** |
| 100Mbpsリンク (逐次) | ~960ms/token (48層逐次) |
| バッチ + パイプライン化 | ~60ms/token (推定) |

## 用語定義

| 用語 | 説明 |
|------|------|
| **Coordinator** | Attention層 + Router層を担当するノード。全MoE層のゲート値を計算し、該当Expertへ隠れ状態を配送する |
| **Expert Worker** | 一部のExpert FFN重みを保持し、Coordinatorから受信した隠れ状態に対してFFN計算を実行するノード |
| **MoE Layer** | Transformer層内のFFN部分がMoE（複数Expert + Router）で構成された層 |
| **Top-k Routing** | 各トークンに対してRouterが全Expertのスコアを計算し、スコア上位k個のExpertのみ活性化する方式 |
| **Speculative Dispatch** | 現在の層のRouter出力から次層の活性化Expertを予測し、事前にExpertノードにデータを送信する最適化手法 (Speculative MoE論文より) |

## 対応対象モデル（優先順）

| モデル | Total Params | Active Params | 備考 | ONNX |
|--------|-------------|---------------|------|------|
| OLMoE-1B-7B | 7.2B | 1.3B | Phase 0検証に最適 | ⚠️ Optimum経由 |
| Qwen3-30B-A3B | 30.5B | 3.3B | **ターゲットモデル** | ⚠️ Optimum確認中 |
| DeepSeek-V2-Lite | 15.7B | 2.4B | 代替候補 (Prism論文で使用) | ⚠️ 確認中 |
| LFM2-8B-A1B | ~8B | ~1B | オンデバイス特化 (Transformers.js v4対応) | ✅ |

## フェーズ概要

| Phase | 内容 | 期間目安 | 状態 |
|-------|------|----------|------|
| 0 | 単一ブラウザ検証 | — | **スキップ** (環境なし) |
| 1-A | ONNX Model Splitter (Python) | 2-3週 | **次フェーズ** |
| 1-B | Expert Worker アーキテクチャ (TS) | 2-3週 | 待機 |
| 2 | マルチノード分散推論 | 3-4週 | 待機 |
| 3 | 最適化・実用化 | 継続的 | 待機 |

## 主要参考文献

1. **Prism**: Accelerating Edge Inference for Distributed MoE Models with Latency-Optimized Expert Placement (arXiv:2508.12851, 2026)
2. **Speculative MoE**: Communication Efficient Parallel MoE Inference (ICML 2025, arXiv:2503.04398)
3. **Semantic Parallelism**: Redefining Efficient MoE Inference via Model-Data Co-Scheduling (ICLR 2026)
4. **Petals**: Collaborative Inference and Fine-tuning of Large Models (NeurIPS 2023, arXiv:2209.01188)
5. **MoBiLE**: Efficient MoE Inference on Consumer GPU with Mixture of Big Little Experts (ASP-DAC 2026)
6. **Qwen3 Technical Report** (arXiv:2505.09388, 2025)
7. **MoE in Transformers**: HuggingFace Blog (Feb 2026) — WeightConverter, Expert Backend, EP設計
8. **Scaling Multi-Node MoE Inference Using Expert Activation Patterns** (arXiv:2604.23150, 2026)
9. **Survey on Inference Optimization for MoE Models** (arXiv:2412.14219, 2024)
10. **MoE CPU-GPU Collaborative Inference** (ASP-DAC 2026, arXiv:2512.16473)

詳細: `docs/todo/moe-research-findings.md`

## 関連ファイル（変更予定）

- `packages/node/src/workloads/ai-inference.ts` — 既存AI推論ハンドラ
- `packages/node/src/client/WebRTCPeer.ts` — P2P DataChannel実装
- `packages/node/src/client/SignalingClient.ts` — Expert協調機能拡張
- `packages/sdk/src/types.ts` — MoEタスク型定義追加
- `packages/worker/src/worker/Coordinator.ts` — マルチノード割当対応
- `packages/worker/src/crowd/index.ts` — MoE APIエンドポイント
