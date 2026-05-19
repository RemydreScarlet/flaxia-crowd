# 05. CPU負荷制限

## 概要

「動画再生と同程度の負荷」という約束を守るため、
CPU使用率を常時監視し、閾値を超えたら処理を一時停止する。

## 目標値

| 状態 | CPU使用率上限 |
|------|-------------|
| デフォルト | 15% |
| ユーザー設定可能範囲 | 5% 〜 30% |

## CPU使用率の計測方法

ブラウザにCPU使用率を直接取得するAPIは存在しない。
以下の方法で**推定**する：

```typescript
// アイドル時間ベースの推定
function estimateCpuLoad(): number {
  return new Promise(resolve => {
    const start = performance.now()
    // 短いビジーループを走らせて、実際にかかった時間と理論値を比較
    let count = 0
    const target = 1_000_000
    for (let i = 0; i < target; i++) count++
    const elapsed = performance.now() - start

    // 基準時間（アイドル時）と比較して負荷を推定
    const baseline = getBaseline() // 初回計測時に記録
    const load = Math.min(1.0, elapsed / baseline - 1.0)
    resolve(load)
  })
}
```

より実用的には `requestIdleCallback` のコールバックが呼ばれるまでの遅延時間で推定する：

```typescript
function measureIdleDelay(): Promise<number> {
  return new Promise(resolve => {
    const start = performance.now()
    requestIdleCallback(() => {
      resolve(performance.now() - start)
    })
  })
}
// 遅延が長いほど = CPUが忙しい
```

## スロットリングロジック

```typescript
class CpuThrottle {
  private readonly maxLoad: number
  private paused = false

  async shouldPause(): Promise<boolean> {
    const delay = await measureIdleDelay()
    // 100ms以上の遅延 = 高負荷とみなす
    return delay > 100
  }

  // Worker実行前に呼ぶ
  async waitForSlot(): Promise<void> {
    while (await this.shouldPause()) {
      await sleep(500)  // 500ms待って再チェック
    }
  }
}
```

## バックグラウンドタブの扱い

`document.visibilityState === 'hidden'` の場合：
- WebSocket接続を切断する
- 処理中タスクがあればWorkerをterminateする
- フォアグラウンド復帰時に再接続する

理由：バックグラウンドタブはブラウザによってthrottleされ、
ユーザーの期待と異なる挙動になるため。

## Pongメッセージへの反映

CPU負荷の推定値は30秒ごとにSignalingサーバーへ報告する：

```typescript
// SignalingClient のPingハンドラ内
const cpuLoad = await throttle.getCurrentLoad()
ws.send(JSON.stringify({
  type: 'pong',
  nodeId: this.nodeId,
  cpuLoad  // 0.0 - 1.0
}))
```

NodeManagerはこの値を使ってタスク割り当て優先度を決定する。
