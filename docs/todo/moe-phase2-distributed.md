# Phase 2: マルチノード分散MoE推論

## 目的

Phase 1-B の Coordinator + Expert Worker アーキテクチャを
複数ブラウザノードに展開する。Coordinatorノードが Expertノード群と
通信しながら分散推論を行う。

## 対象モデル: DeepSeek-V4-Flash (284B)

- Coordinator: ~3.6GB (bf16) / ~1.8GB (int8)
- Expert 1個: ~2.5GB (bf16) / ~640MB (int4)
- 全256 Expertをカバーするには Expert Worker 数十ノードが必要

## 通信方式

| 方式 | レイテンシ | NAT越え | 複雑さ | 採用 |
|------|-----------|---------|--------|------|
| Cloudflare Relay (WS) | 高 (〜100ms) | 不要 | 低 | V1 |
| WebRTC DataChannel | 低 (〜10ms) | STUN/TURN必要 | 中 | V2 |

**Phase 2では Cloudflare Relay を採用**。WebRTCは Phase 3 で最適化。

## TODOリスト

### 2.1 通信プロトコル設計
- [ ] Coordinator → Expert メッセージ形式 (ExpertDispatchRequest)
- [ ] Expert → Coordinator 応答形式 (ExpertDispatchResponse)
- [ ] Shared Expert は Coordinator 内で計算（通信不要）
- [ ] Hash-routed layer のルーティング結果（固定）の事前通知
- [ ] エラー・ハートビート形式

### 2.2 Cloudflare Relay 実装
- [ ] `packages/worker/src/crowd/moe-relay.ts` 作成
  - Expertノードからの WebSocket persistent connection
  - Coordinatorノードからのディスパッチ要求受付・転送
  - 結果返送・タイムアウト処理
- [ ] `packages/worker/src/crowd/index.ts` にルート追加
- [ ] wrangler.toml 設定追記

### 2.3 Expert ノード実装 (ブラウザ)
- [ ] `packages/node/src/workloads/moe-expert-node.ts` 作成
  - Cloudflare Relay接続 (WebSocket)
  - 担当Expert ONNXモデルロード (int4量子化想定)
  - ディスパッチ要求受信 → FFN計算 → 結果返送
  - ハートビート送信

### 2.4 Coordinator ノード実装 (ブラウザ)
- [ ] `packages/node/src/workloads/moe-coordinator-node.ts` 作成
  - Phase 1-B の拡張 (Expert計算をリモート呼び出しに置換)
  - 並列Expertディスパッチ (Promise.all)
  - タイムアウト + リトライ

### 2.5 オーケストレータ拡張
- [ ] `packages/worker/src/worker/Coordinator.ts` 拡張
  - MoE推論タスク受付・リソース確保
  - `allocateMoEResources(modelId, numExperts)`:
    1. Coordinator候補選択
    2. Expert割当表の通知
    3. 必要なExpert数をカバーするノード選択
    4. 全ノード準備確認後タスク開始

### 2.6 分散推論セッション管理
- [ ] `packages/worker/src/worker/MoESession.ts` 作成
  - セッション: Coordinator 1 + Expert N
  - ライフサイクル: allocating → ready → running → cleanup
  - Expertノード離脱検出 → 代替割当 or 終了

### 2.7 統合テスト
- [ ] 同一マシン・複数ブラウザタブでの分散推論テスト
- [ ] 異なるマシンでの動作確認（同一LAN）

### 成果物
- [ ] `packages/worker/src/crowd/moe-relay.ts`
- [ ] `packages/node/src/workloads/moe-expert-node.ts`
- [ ] `packages/node/src/workloads/moe-coordinator-node.ts`
- [ ] `packages/worker/src/worker/MoESession.ts`
- [ ] `packages/worker/src/worker/Coordinator.ts` の拡張
