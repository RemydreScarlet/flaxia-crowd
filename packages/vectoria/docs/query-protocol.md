# 検索クエリプロトコル

## 概要

Vectoria の検索は、Flaxia Crowd ノードへの vector-query ファンアウトと orchestrator でのマージによって実現します。

## 検索フロー (詳細)

```
User                   Vectoria            Flaxia SDK          Flaxia Worker         Crowd Nodes
 │                        │                    │                      │                   │
 │  検索クエリ入力        │                    │                      │                   │
 │───────────────────────▶│                    │                      │                   │
 │                        │                    │                      │                   │
 │                        │  POST /api/search  │                      │                   │
 │                        │   { q: "hello" }   │                      │                   │
 │                        │───────────────────▶│                      │                   │
 │                        │                    │                      │                   │
 │                        │                    │  vector-embed submit  │                   │
 │                        │                    │  (クエリ埋め込み)     │                   │
 │                        │                    │──────────────────────▶│                  │
 │                        │                    │                      │ → pick node       │
 │                        │                    │                      │──────────────────▶│
 │                        │                    │                      │  WebSocket: task  │
 │                        │                    │                      │◀──────────────────│
 │                        │                    │                      │  result           │
 │                        │                    │◀─────────────────────│                   │
 │                        │◀───────────────────│                      │                   │
 │                        │                    │                      │                   │
 │                        │  vector-query      │                      │                   │
 │                        │  (queryVector      │                      │                   │
 │                        │   + token)         │                      │                   │
 │                        │───────────────────▶│  全 storage node     │                   │
 │                        │                    │  ~~~~~~~~~~▶         │                   │
 │                        │                    │──────────────────────▶│                  │
 │                        │                    │                      │                  │
 │                        │                    │                      │──── vector-query ─▶│
 │                        │                    │                      │◀── top-10 results ─│
 │                        │                    │                      │                   │
 │                        │                    │                      │──── vector-query ─▶│
 │                        │                    │                      │◀── top-10 results ─│
 │                        │                    │                      │                   │
 │                        │                    │                      │ マージ・重複除去   │
 │                        │                    │                      │ ソート・top-10    │
 │                        │                    │◀─────────────────────│                   │
 │                        │◀───────────────────│                      │                   │
 │                        │                    │                      │                   │
 │  Google風結果表示      │                    │                      │                   │
 │◀──────────────────────│                    │                      │                   │
```

## Flaxia Worker エンドポイント追加

`packages/worker/src/crowd/index.ts`:

```typescript
app.post('/query', async (c) => {
  const { queryVector, topK = 10 } = await c.req.json() as {
    queryVector: number[]
    topK?: number
  }

  // VectorIndex DO から全 storage node を取得
  const vectorIndexId = c.env.VECTOR_INDEX.idFromName('global-vector-index')
  const vectorIndex = c.env.VECTOR_INDEX.get(vectorIndexId)
  const nodesResp = await vectorIndex.fetch(new Request('http://internal/query-nodes'))
  const { nodes } = await nodesResp.json() as { nodes: NodeShardInfo[] }

  if (nodes.length === 0) {
    return c.json({ results: [], message: 'No storage nodes available' })
  }

  // 各ノードに vector-query タスクを submit
  const taskPromises = nodes.map(node => {
    const taskId = crypto.randomUUID()
    const task: TaskRecord = {
      id: taskId,
      status: 'pending',
      workload: 'vector-query',
      payload: { queryVector, topK },
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    }
    const taskQueueId = c.env.TASK_QUEUE.idFromName('global-queue')
    const taskQueue = c.env.TASK_QUEUE.get(taskQueueId)
    return taskQueue.enqueue(task).then(() => taskId)
  })

  const taskIds = await Promise.all(taskPromises)

  // 全タスク完了を待機 (polling or DO タグベース)
  const allResults: VectorQueryResult[] = []
  const maxWaitMs = 15000
  const pollStart = Date.now()

  while (allResults.length < taskIds.length && Date.now() - pollStart < maxWaitMs) {
    for (const taskId of taskIds) {
      const taskQueueId = c.env.TASK_QUEUE.idFromName('global-queue')
      const taskQueue = c.env.TASK_QUEUE.get(taskQueueId)
      const task = await taskQueue.getTask(taskId)
      if (task?.status === 'done') {
        if (!allResults.find(r => r.nodeId === task.assignedNodeId)) {
          allResults.push(task.result as VectorQueryResult)
        }
      }
    }
    if (allResults.length < taskIds.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // マージ処理
  const merged = mergeResults(allResults)
  return c.json({ results: merged.slice(0, topK), totalNodes: allResults.length })
})

function mergeResults(nodesResults: VectorQueryResult[]): Array<{
  docId: string
  score: number
  metadata: { title: string; url: string; snippet: string }
}> {
  const merged = new Map<string, {
    docId: string
    score: number
    metadata: { title: string; url: string; snippet: string }
    sources: number
  }>()

  for (const nodeResult of nodesResults) {
    for (const r of nodeResult.results) {
      const existing = merged.get(r.docId)
      if (!existing || r.score > existing.score) {
        merged.set(r.docId, { ...r, sources: 1 })
      } else if (existing) {
        existing.sources++
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
}
```

## ファンアウト最適化

### 全件ファンアウト (デフォルト)

全 storage node に query を送信。ノード数が少ない初期段階ではこれで十分。

### ランダムサンプリング (ノード数 > 50 時)

```typescript
function sampleNodes(nodes: NodeShardInfo[], sampleSize: number): NodeShardInfo[] {
  const shuffled = [...nodes].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, sampleSize)
}
```

### 信頼度ベース (長期的)

各ノードの過去の成功率・応答時間を元に weighted sampling。

## NodeManager の storage ノード選択

`pickNode` に workload フィルタを追加：

```typescript
// NodeManager.ts - pickNode は既に capabilities でフィルタしている
// vector-query や vector-store は 'vector-store' capability を持つノードのみに割り当て
```

## wrangler.toml 設定追加

```toml
[[durable_objects.bindings]]
name = "VECTOR_INDEX"
class_name = "VectorIndex"

[[migrations]]
tag = "v2"
new_classes = ["VectorIndex"]
```

## エラー処理

| シナリオ | 動作 |
|---|---|
| 全 storage node 消失 | `{ results: [], message: 'No storage nodes available' }` を返す |
| 一部ノードタイムアウト | 結果が出たノードのみでマージ、タイムアウトは無視 |
| クエリ embedding 失敗 | `vector-embed` のリトライ (最大3回)、失敗時は 500 エラー |
| ノード応答なし | TaskQueue のタイムアウト・リトライ機構で自動再試行 |
