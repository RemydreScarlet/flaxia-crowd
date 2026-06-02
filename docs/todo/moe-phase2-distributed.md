# Phase 2: マルチノード分散MoE推論

## 目的

Phase 1-B の Coordinator + Expert Worker アーキテクチャを
複数ブラウザノードに展開する。Coordinatorノードが Expertノード群と
通信しながら分散推論を行う。

## 通信方式の選択肢

| 方式 | レイテンシ | NAT越え | 複雑さ | 採用 |
|------|-----------|---------|--------|------|
| Cloudflare Relay (WS) | 高 (〜100ms) | 不要 | 低 | V1 |
| WebRTC DataChannel | 低 (〜10ms) | STUN/TURN必要 | 中 | V2 |
| WebRTC Mesh | 低 | 同上 | 高 | V3 (複数Coordinator案) |

**Phase 2では Cloudflare Relay を採用**。WebRTCは Phase 3 で最適化。

## TODOリスト

### 2.1 通信プロトコル設計

- [ ] Coordinator → Expert メッセージ形式:
  ```typescript
  // Expert Dispatch Protocol (EDP)
  interface ExpertDispatchRequest {
    protocol: 'edp/1.0';
    type: 'forward';
    requestId: string;
    secret: string;          // 認証トークン
    expertIndices: number[];  // このノードに割り当てられたExpert番号
    hiddenStates: number[];   // フラット化された隠れ状態
    dim: number;              // 隠れ状態の次元
    tokenCount: number;       // トークン数（バッチ）
  }
  ```
- [ ] Expert → Coordinator 応答形式:
  ```typescript
  interface ExpertDispatchResponse {
    protocol: 'edp/1.0';
    type: 'result';
    requestId: string;
    outputs: number[][];     // [expertIdx][token * dim] の出力
  }
  ```
- [ ] エラー・ハートビート形式
- [ ] メッセージシリアライゼーション (MsgPack vs JSON)

### 2.2 Cloudflare Relay 実装

- [ ] `packages/worker/src/crowd/moe-relay.ts` 作成:
  - Expertノードからの WebSocket persistent connection
  - Coordinatorノードからのディスパッチ要求受付
  - 要求を該当Expertノードに転送
  - 結果をCoordinatorに返送
  - タイムアウト処理 (デフォルト 10s)
- [ ] `packages/worker/src/crowd/index.ts` にルート追加:
  - `POST /moe/dispatch` — Coordinator → Relay → Expert
  - `GET /moe/ws` — Expertノード用 WebSocket
- [ ] `wrangler.toml` に MoE関連の環境変数追加:
  - `MOE_EXPERT_TIMEOUT_MS`
  - `MOE_MAX_EXPERTS_PER_NODE`

### 2.3 Expert ノード実装 (ブラウザ)

- [ ] `packages/node/src/workloads/moe-expert-node.ts` 作成:
  - Cloudflare Relayに WebSocket 接続
  - 担当Expert ONNXモデルをロード
  - ディスパッチ要求を受信 → FFN計算 → 結果返送
  - ハートビート送信 (5秒間隔)
- [ ] Expertノード用の `NodeConfig` 拡張:
  ```typescript
  interface MoENodeConfig {
    role: 'expert';
    modelId: string;
    expertIndices: number[];  // このノードが担当するExpert番号
    relayUrl: string;         // Cloudflare Relay URL
  }
  ```

### 2.4 Coordinator ノード実装 (ブラウザ)

- [ ] `packages/node/src/workloads/moe-coordinator-node.ts` 作成:
  - Phase 1-B の `MoECoordinatorPipeline` を拡張
  - Expert計算部分をリモート呼び出しに置換
  - 並列 Expert ディスパッチ (Promise.all)
  - タイムアウト + リトライ
  - 低速Expertの検出と動的タイムアウト調整
- [ ] Coordinatorノード用の `NodeConfig` 拡張:
  ```typescript
  interface MoECoordinatorNodeConfig {
    role: 'coordinator';
    modelId: string;
    relayUrl: string;
    expertAllocation: Map<number, string>;  // expertIdx → nodeId
  }
  ```

### 2.5 オーケストレータ拡張 (Coordinator.ts)

- [ ] `packages/worker/src/worker/Coordinator.ts` 拡張:
  - MoE推論タスク受付時、Coordinatorノード + Expertノード群を確保
  - Expertノードのcapabilityに `'moe-expert'` 追加
  - Coordinatorノードのcapabilityに `'moe-coordinator'` 追加
  - `allocateMoEResources(modelId, numExperts)`:
    1. 最適なCoordinator候補を選択 (WebGPU対応、メモリ余裕)
    2. Coordinatorにエキスパート割当表を通知
    3. 必要なExpert数をカバーするExpertノードを選択
    4. 各Expertノードに担当ExpertとCoordinator情報を通知
    5. 全ノードの準備完了を確認してからタスク開始
- [ ] 新しいタスク状態追加:
  - `'moe_allocating'` — リソース確保中
  - `'moe_ready'` — 全ノード準備完了
  - `'moe_running'` — 推論実行中

### 2.6 分散推論セッション管理

- [ ] `packages/worker/src/worker/MoESession.ts` 作成:
  - MoEセッション: Coordinator 1 + Expert N のグループ
  - セッションライフサイクル管理:
    ```
    allocating → ready → running → cleanup
    ```
  - Expertノード離脱検出 → 代替Expertの割当 or セッション終了
  - セッションタイムアウト (デフォルト 5分)
- [ ] Coordinator.ts に MoESession 管理を統合

### 2.7 統合テスト

- [ ] 同一マシン・複数ブラウザタブでの分散推論テスト
  - Coordinator: タブ1
  - Expert: タブ2, タブ3, ...
  - Cloudflare Relay (ローカル dev server) 経由で通信
- [ ] 異なるマシンでの動作確認（同一LAN）
- [ ] テスト項目:
  - 1トークン生成のレイテンシ
  - トークン/sec スループット
  - Expertノード離脱時の復旧
  - 複数トークン生成の整合性（単一ブラウザ結果と比較）

### 成果物

- [ ] `packages/worker/src/crowd/moe-relay.ts` — Cloudflare Relay
- [ ] `packages/node/src/workloads/moe-expert-node.ts` — Expertノード
- [ ] `packages/node/src/workloads/moe-coordinator-node.ts` — Coordinatorノード(分散版)
- [ ] `packages/worker/src/worker/MoESession.ts` — セッション管理
- [ ] `packages/worker/src/worker/Coordinator.ts` の拡張

## プロトコル図

```
Coordinator Node            Cloudflare Relay           Expert Node A
      │                          │                          │
      │  allocateMoEResources()  │                          │
      │ ─────────────────────►   │                          │
      │                          │  assignExpert(1,2,3)     │
      │                          │ ─────────────────────►   │
      │                          │  ◄── ack ─────────────   │
      │  ◄── session_ready ────  │                          │
      │                          │                          │
      │ ───────────────────────────────────────────────────►│
      │  dispatch(layer=3,       │                          │
      │   experts=[1,2,7],       │                          │
      │   hiddenState=[...])     │                          │
      │                          │                          │
      │                          │        (Expert 1,2のみ)  │
      │                          │ ◄── result ────────────  │
      │ ◄── result ───────────── │                          │
      │                          │                          │
```
