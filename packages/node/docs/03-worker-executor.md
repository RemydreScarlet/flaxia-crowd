# 03. WebWorkerでの処理実行

## 概要

実際の処理はメインスレッドをブロックしないよう、すべて**WebWorker内**で実行する。
メインスレッドはSignaling・UI・CPU監視のみ担当する。

## WorkerPool 設計

```typescript
class WorkerPool {
  private worker: Worker | null = null

  async run(workload: WorkloadType, payload: unknown): Promise<unknown>
  terminate(): void
}
```

Phase 1では並列実行はしない（1ノード1タスク）。
Workerは1つだけ起動し、タスクが来るたびにメッセージを送る。

## Worker内部の構造

```
src/worker/main.worker.ts
  ↓ 動的import
src/workloads/ai-inference.ts   （Transformer.js）
src/workloads/image-process.ts  （OffscreenCanvas）
src/workloads/file-convert.ts   （WASM）
```

## メッセージプロトコル（メインスレッド ↔ Worker）

### メインスレッド → Worker

```typescript
type WorkerRequest = {
  id: string            // リクエストID（タスクIDと同じ）
  workload: WorkloadType
  payload: unknown
  timeoutMs: number
}
```

### Worker → メインスレッド

```typescript
type WorkerResponse =
  | { id: string; type: 'progress'; percent: number }
  | { id: string; type: 'done'; result: unknown; processingMs: number }
  | { id: string; type: 'error'; error: string }
```

## タイムアウト処理

```typescript
// WorkerPool.run() 内
const timeoutId = setTimeout(() => {
  this.worker?.terminate()
  this.worker = null
  reject(new Error('TIMEOUT'))
}, payload.timeoutMs)
```

タイムアウト時はWorkerをterminateして再生成する。

## Viteでのビルド設定

```typescript
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // Worker用エントリーを別チャンクに分離
      input: {
        index: 'src/index.ts',
        worker: 'src/worker/main.worker.ts',
      }
    }
  }
})
```

WorkerのURLは `new Worker(new URL('./worker/main.worker.ts', import.meta.url))` で参照する。
Viteがworkerを自動的に別バンドルに分離してくれる。
