# 02. ノードクライアント（Signaling接続管理）

## 概要

同意後、Signalingサーバー（Cloudflare Workers）にWebSocket接続し、
タスクの受信・WebRTC接続の確立を管理する。

## 接続フロー

```
1. POST /crowd/nodes/register → ノードトークン取得
2. WS  /crowd/signal?token=xxx → Signaling接続確立
3. { type: 'hello', nodeId } を受信 → 接続完了
4. タスク待機状態へ
```

## SignalingClient 実装方針

```typescript
class SignalingClient {
  private ws: WebSocket | null = null
  private nodeId: string | null = null
  private reconnectAttempts = 0
  private readonly MAX_RECONNECT = 5

  async connect(orchestratorUrl: string, siteId: string): Promise<void>
  disconnect(): void
  private onMessage(event: MessageEvent): void
  private scheduleReconnect(): void
}
```

## 再接続ロジック

指数バックオフで最大5回まで再接続を試みる：

```
1回目: 1秒後
2回目: 2秒後
3回目: 4秒後
4回目: 8秒後
5回目: 16秒後
→ 諦める（ユーザーには通知しない・サイレント）
```

ページのvisibility変化にも対応する：

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // バックグラウンドになったら切断（CPU節約）
    this.disconnect()
  } else {
    // フォアグラウンドに戻ったら再接続
    this.connect(...)
  }
})
```

## WebRTCPeer 実装方針

```typescript
class WebRTCPeer {
  private pc: RTCPeerConnection
  private dataChannel: RTCDataChannel | null = null

  // Workerからofferを受け取りanswerを生成
  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>

  // DataChannelでタスクのpayloadを受け取り・結果を返す
  private onDataChannel(channel: RTCDataChannel): void
}
```

## ICE設定

```typescript
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  // TURNはPhase 2で追加検討
]
```

## タスク受信から実行までの流れ

```
SignalingClient: { type: 'task', taskId, workload, payload, offer } 受信
    ↓
WebRTCPeer.handleOffer(offer) → answer生成
    ↓
SignalingClient: { type: 'answer', taskId, answer } 送信
    ↓
DataChannel確立
    ↓
WorkerExecutor.run(workload, payload) 呼び出し
    ↓
SignalingClient: { type: 'result', taskId, success, payload } 送信
```

## エラーハンドリング

- WebRTC接続失敗 → `{ type: 'result', success: false, error: 'WEBRTC_FAILED' }` を送信
- 処理タイムアウト → `{ type: 'result', success: false, error: 'TIMEOUT' }` を送信
- いずれの場合もWorker側がリトライを処理する
