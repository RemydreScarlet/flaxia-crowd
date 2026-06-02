# Phase 1-B: Expert Worker アーキテクチャ

## 目的

単一ブラウザタブ内で Coordinator (メインスレッド) + Expert (Web Worker) の
並列推論フレームワークをTypeScriptで実装する。
マルチノード展開のプロトタイプ基盤とする。

## アーキテクチャ

```
メインスレッド (Coordinator)
┌──────────────────────────────────────────────────────────────────┐
│  DeepSeekV4CoordinatorPipeline                                   │
│  ├─ Embedding(h) → h_emb                                        │
│  ├─ Layer 0..1: HashRouter + SharedExpert (Coordinator内完結)   │
│  ├─ Layer 2..59:                                                 │
│  │   ├─ Attention (MQA + CSA/HCA) → hidden                      │
│  │   ├─ mHC (Sinkhorn residual mixing)                          │
│  │   ├─ Router(hidden) → expert indices/weights                 │
│  │   ├─ SharedExpert FFN (Coordinator内)                        │
│  │   ├─ ExpertPool.forward(indices, hidden) → routed_outputs    │
│  │   └─ output = shared_out + sum(weight[i] * routed_out[i])    │
│  ├─ MTP Head (オプション)                                        │
│  └─ OutputHead → logits                                          │
└──────────────────────┬───────────────────────────────────────────┘
                       │ postMessage (transfer)
                       ▼
Web Worker (ExpertPool)
┌──────────────────────────────────────────────────────────────────┐
│  ExpertPoolManager (複数Worker管理)                               │
│  ├─ Worker 0: Expert 0-3, 8-11                                  │
│  │   ONNX session  (expert_N.onnx)                               │
│  ├─ Worker 1: Expert 4-7, 12-15                                 │
│  └─ 各Workerからの結果をCollect → 集約してCoordinatorに返却      │
└──────────────────────────────────────────────────────────────────┘
```

## V4独自の考慮点

### mHC (Manifold-Constrained Hyper-Connections)
- 各層で4-streamのresidual mixing (Sinkhorn-Knopp反復)
- Coordinator側で完結（Expert Workerとの通信不要）
- Sinkhorn-Knopp反復はiterativeアルゴリズム → WASM実装注意

### CSA/HCA Hybrid Attention
- 層ごとに compress_ratios で attention type が異なる
- 圧縮率に応じてKVキャッシュ管理が複雑
- Coordinator側で完結（Expertとの通信不要）

### Hash-routed MoE (最初の2層)
- softmax router不使用 → 決定論的 expert 選択
- Coordinator側で完結（ルーティング無し、全トークンが固定expertへ）
- Expert Workerへの要求は他の層と同様

### Multi-Token Prediction (MTP)
- 1層のauxiliary head（オプション）
- Coordinator側で計算
- メイン生成には影響しない（トレーニング用補助損失）

## TODOリスト

### 1-B.1 型定義拡張
- [ ] `packages/sdk/src/types.ts` にMoE関連型を追加:
  - `MoEInferencePayload`
  - `MoEExpertRequest` / `MoEExpertResponse`
  - `MoECoordinatorMessage` / `MoEExpertPoolMessage`
- [ ] `WorkloadType` に `'moe-inference'` 追加
- [ ] `NodeRecord` に `role?: 'coordinator' | 'expert'` 追加

### 1-B.2 MoE Expert Pool (Web Worker)
- [ ] `packages/node/src/workloads/moe-expert-pool.worker.ts` 作成
  - ONNX session 管理 (1 session / expert)
  - SwiGLU FFN 実行 (MatMul → SiLU(MatMul) → Mul → MatMul)
  - Transferable オブジェクト対応
- [ ] 複数Expertの並列実行制御
- [ ] エラーハンドリング・タイムアウト

### 1-B.3 Coordinator Pipeline
- [ ] `packages/node/src/workloads/moe-coordinator.ts` 作成
  - Coordinator ONNXモデルロード
  - Attention + mHC + Shared Expert 実行
  - Router実行 (top-7 + weights)
  - ExpertPool連携 (forward依頼 → 結果集約 → 重み付き和)
  - 生成ループ (auto-regressive decoding)

### 1-B.4 ワークロードハンドラ
- [ ] `packages/node/src/workloads/moe-inference.ts` 作成
- [ ] `main.worker.ts` に `'moe-inference'` ケース追加

### 1-B.5 検証
- [ ] テストモデル (DeepSeek-V4-Mini) での単一ブラウザ推論テスト
- [ ] Coordinator出力 vs PyTorch元モデル 比較検証

### 成果物
- [ ] `packages/node/src/workloads/moe-expert-pool.worker.ts`
- [ ] `packages/node/src/workloads/moe-coordinator.ts`
- [ ] `packages/node/src/workloads/moe-inference.ts`
- [ ] `packages/sdk/src/types.ts` の拡張
- [ ] テストコード
