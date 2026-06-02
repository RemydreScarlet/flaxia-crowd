# MoE 分散推論 全体計画

## 目標

flaxia-crowd の分散ノード網を活用し、DeepSeek-V4-FlashクラスのMoEモデルを複数ブラウザノードに分散配置。
Coordinatorノードが Attention + Router を担当し、Expert Workerノードが FFN 計算を担当することで、
単一ブラウザでは載らない大規模MoEモデル (284B 総パラメータ) の推論を実現する。

## ターゲットモデル: DeepSeek-V4-Flash

| 項目 | 値 |
|------|-----|
| 総パラメータ | 284B |
| 活性化パラメータ/トークン | 13B |
| hidden_size | 3072 |
| num_hidden_layers | 60 |
| num_attention_heads | 24 |
| num_key_value_heads | 1 (MQA) |
| head_dim | 128 |
| n_routed_experts | 256 (うち最初の2層はhash-routed + shared expert) |
| n_shared_experts | 1 |
| num_experts_per_tok | 8 (shared expert + routed top-7) |
| moe_intermediate_size | 1536 |
| 活性化関数 | clamped SwiGLU |
| ルーティング | sqrt(softplus) + expert bias |
| コンテキスト長 | 1,048,576 (YaRN factor=16) |
| vocab_size | 129280 |

### アーキテクチャ特徴（V4独自）
- **Hybrid Attention**: Compressed Sparse Attention (CSA) + Heavily Compressed Attention (HCA)
- **Manifold-Constrained Hyper-Connections (mHC)**: Sinkhorn-Knopp による4-stream residual mixing
- **Hash-routed MoE**: 最初の2層は決定論的 vocab→expert マッピング
- **Multi-Token Prediction (MTP)**: 1層の auxiliary prediction head
- **Shared Expert**: 全トークンが常に通る共有FFN（出力はルーティング結果に加算）

### メモリ試算 (bf16)

| コンポーネント | パラメータ量 | 概算サイズ |
|---|---|---|
| **Coordinator計** | — | **~3.6GB** |
| ├ Embedding | 129280 × 3072 | ~758MB |
| ├ Attention (60層) | 60 × (MQA: Q=3072×128, KV=128×128×2, O=128×3072) | ~285MB + mHC/CSA/HCA |
| ├ Router (58層) | 58 × 3072 × 256 | ~456MB (ルーティング重み) |
| ├ Shared Expert (58層) | 58 × (1536×3072×2 + 3072×1536) × 2 (Sw+G, Up, Down) | ~3.7GB |
| └ Output Head | 3072 × 129280 | ~758MB |
| **Expert 1個 (58層)** | 58 × 1536 × 3072 × 3 (Gate+Up+Down) | ~2.5GB (bf16) |
| **Expert 1個 (int8)** | — | ~1.25GB |
| **Expert 1個 (int4)** | — | ~640MB |

## 分割戦略: ファイルレベル分割（方針転換）

### 従来案 (ONNX Subgraph Manipulation)
```
model.onnx → ONNXグラフ解析 → サブグラフ抽出 (coordinator.onnx + expert_N.onnx)
```
**課題**: QMoEカスタムopの内部構造解析が必要。モデルごとの調整が膨大。

### 新方式: PyTorch → ファイル分割 → 個別ONNXエクスポート
```
model.safetensors (PyTorch)
  │
  ├── scripts/convert-moe-model.py
  │
  ├── coordinator/
  │   ├── model.safetensors  (非Expert重み)
  │   └── model.onnx         (エクスポート後)
  │
  └── experts/
      ├── expert_000/
      │   ├── model.safetensors  (Gate, Up, Down)
      │   └── model.onnx
      ├── expert_001/
      └── ...
```

**メリット**:
- QMoEカスタムopの解析不要（標準ONNX opsのみ）
- PyTorch → ONNX export で正しさを検証可能
- モデル構造変更に追従しやすい
- int8/int4量子化も export 前に行える

## 通信量試算 (DeepSeek-V4-Flash)

| 項目 | 値 |
|------|-----|
| 1 Layerあたりの送信 | 7 routed experts × 3072 × 2bytes = 43KB |
| 1 Layerあたりの受信 | 7 routed experts × 3072 × 2bytes = 43KB |
| Shared Expert通信 | 3072 × 2bytes × 2 (送受) = 12KB |
| 1 Layerあたり合計 | ~98KB |
| 全58 MoE層 | **~5.7MB/token** |
| Shared Expert 58層 | ~0.7MB |
| 合計 | **~6.4MB/token** |
| バッチ4トークン | **~25.6MB/token step** |

## 用語定義

| 用語 | 説明 |
|------|------|
| **Coordinator** | Attention層 + mHC + Router + Shared Expert を担当するノード。全MoE層のゲート値を計算し、該当Expertへ隠れ状態を配送する |
| **Expert Worker** | 一部のExpert FFN重み (Gate+Up+Down) を保持し、Coordinatorから受信した隠れ状態に対してFFN計算を実行するノード |
| **Shared Expert** | 全トークンが常に通る共有FFN。Routerの結果に加算される。Coordinator側で計算 |
| **Hash-routed MoE** | 最初の数層で使用。softmax routerの代わりにvocab IDから決定論的にExpertを選択 |
| **mHC** | Manifold-Constrained Hyper-Connections。Sinkhorn-Knopp反復で残差結合を強化するV4独自機構 |
| **Speculative Dispatch** | 現在の層のRouter出力から次層の活性化Expertを予測し、事前にExpertノードにデータを送信する最適化手法 |

## 開発順序

| Phase | 内容 | 期間目安 | 状態 |
|-------|------|----------|------|
| 0 | テストモデル調査 | — | **完了** (kshitijthakkar/deepseek-v4-mini-3B-init) |
| 1-A | PyTorch → ファイル分割 → ONNX変換 (Python) | 2-3週 | **次フェーズ** |
| 1-B | Expert Worker アーキテクチャ (TS) | 2-3週 | 待機 |
| 2 | マルチノード分散推論 (WebRTC + Relay) | 3-4週 | 待機 |
| 3 | 最適化・実用化 (量子化転送・Speculative Dispatch) | 継続的 | 待機 |

## 開発マイルストーン

### Phase 1-A (次フェーズ)
- `kshitijthakkar/deepseek-v4-mini-3B-init` で PyTorch チェックポイント分割を開発
- Coordinator / Expert 個別 ONNX エクスポート
- 分割後モデルの推論一致検証 (元出力と比較)

### Phase 1-B
- TypeScript Expert Pool (Web Worker)
- TypeScript Coordinator Pipeline
- Transformers.js v5 との統合

### Phase 2
- Cloudflare Relay によるノード間通信
- マルチノード分散推論
- Expert 動的割当

### Phase 3
- WebRTC P2P 最適化
- Speculative Dispatch
- Expert 動的再配置・複製

## 主要参考文献

1. **DeepSeek-V4 Technical Report** (arXiv, Apr 2026)
2. **Prism**: Accelerating Edge Inference for Distributed MoE Models (arXiv:2508.12851, 2026)
3. **Speculative MoE**: Communication Efficient Parallel MoE Inference (ICML 2025, arXiv:2503.04398)
4. **Semantic Parallelism**: Redefining Efficient MoE Inference via Model-Data Co-Scheduling (ICLR 2026)
5. **Petals**: Collaborative Inference and Fine-tuning of Large Models (NeurIPS 2023, arXiv:2209.01188)
6. **HuggingFace Transformers v5**: Expert Parallelism, WeightConverter

詳細: `docs/todo/moe-research-findings.md`
