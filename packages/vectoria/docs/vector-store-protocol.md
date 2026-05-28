# 分散ベクトルストアプロトコル

## 概要

Flaxia Crowd ノードのブラウザ IndexedDB 上に HNSW (Hierarchical Navigable Small World) グラフを構築し、分散ベクトルストアを実現します。

## IndexedDB スキーマ

### データベース

```
Name:  "flaxia-vector-store"
Version: 1
```

### ObjectStore: `vectors`

| フィールド | 型 | 説明 |
|---|---|---|
| `docId` (key) | `string` | ドキュメント ID (`crc32(url):chunkIndex`) |
| `vector` | `Float32Array` | 1024 次元ベクトル (バイナリ) |
| `metadata` | `object` | 検索時表示用メタデータ |
| `metadata.title` | `string` | ページタイトル |
| `metadata.url` | `string` | URL |
| `metadata.snippet` | `string` | 抜粋テキスト |
| `shardKey` | `string` | シャードキー (orchestrator 割り当て) |
| `storedAt` | `number` | 保存時刻 (epoch ms) |

### ObjectStore: `hnsw-graph`

| フィールド | 型 | 説明 |
|---|---|---|
| `nodeId` (key) | `number` | HNSW グラフノード ID (0, 1, 2...) |
| `level` | `number` | HNSW 階層レベル (0=最下層) |
| `docId` | `string` | 対応ドキュメント ID |
| `neighbors` | `number[]` | 同レベル内の隣接ノード ID 配列 |
| `enterPoint` | `boolean` | エントリポイントか |

### ObjectStore: `shard-info`

| フィールド | 型 | 説明 |
|---|---|---|
| `key` (key) | `string` | `'shard_range'` |
| `rangeStart` | `number` | 担当シャード範囲開始 |
| `rangeEnd` | `number` | 担当シャード範囲終了 |
| `nodeId` | `string` | このノードの ID |
| `assignedAt` | `number` | 割り当て時刻 |

## VectorStoreEngine (Node 側)

`packages/node/src/vector-store/VectorStoreEngine.ts`:

```typescript
export class VectorStoreEngine {
  private db: IDBDatabase | null = null
  private hnsw: HNSWIndex | null = null
  private shardInfo: { rangeStart: number; rangeEnd: number } | null = null

  // IndexedDB を開く (初回は作成)
  async initialize(nodeId: string): Promise<void> {
    this.db = await openDB('flaxia-vector-store', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('vectors')) {
          db.createObjectStore('vectors', { keyPath: 'docId' })
        }
        if (!db.objectStoreNames.contains('hnsw-graph')) {
          db.createObjectStore('hnsw-graph', { keyPath: 'nodeId' })
        }
        if (!db.objectStoreNames.contains('shard-info')) {
          db.createObjectStore('shard-info', { keyPath: 'key' })
        }
      },
    })

    // HNSW インデックス初期化
    this.hnsw = new HNSWIndex(1024, 'cosine', 16, 200)
    await this.loadGraphFromDB()
  }

  // Orchestrator からシャード割り当て通知を受信
  async assignShard(rangeStart: number, rangeEnd: number): Promise<void> {
    this.shardInfo = { rangeStart, rangeEnd }
    const tx = this.db!.transaction('shard-info', 'readwrite')
    tx.objectStore('shard-info').put({
      key: 'shard_range',
      rangeStart,
      rangeEnd,
      assignedAt: Date.now(),
    })
    await tx.done
  }

  // ベクトル保存
  async store(payload: VectorStorePayload): Promise<VectorStoreResult> {
    if (!this.shardInfo) throw new Error('No shard assigned')

    // シャード範囲チェック
    const shardKey = parseInt(payload.shardKey, 10)
    if (shardKey < this.shardInfo.rangeStart || shardKey > this.shardInfo.rangeEnd) {
      throw new Error(`Shard key ${shardKey} out of range`)
    }

    // IndexedDB に保存
    const tx = this.db!.transaction('vectors', 'readwrite')
    tx.objectStore('vectors').put({
      docId: payload.docId,
      vector: new Float32Array(payload.vector),
      metadata: payload.metadata,
      shardKey: payload.shardKey,
      storedAt: Date.now(),
    })
    await tx.done

    // HNSW グラフに挿入
    this.hnsw!.insert(payload.docId, new Float32Array(payload.vector))
    await this.saveGraphSnapshot()

    return {
      stored: true,
      nodeId: self.crypto.randomUUID(),
      shardKey: payload.shardKey,
      totalVectors: this.hnsw!.size(),
    }
  }

  // ベクトル検索 (ローカルHNSW)
  async query(payload: VectorQueryPayload): Promise<VectorQueryResult> {
    if (!this.hnsw) throw new Error('HNSW not initialized')

    const startTime = performance.now()
    const queryVec = new Float32Array(payload.queryVector)
    const neighbors = this.hnsw.search(queryVec, payload.topK)

    const results = neighbors.map(n => ({
      docId: n.docId,
      score: n.distance,
      metadata: n.metadata,
    }))

    return {
      results,
      nodeId: self.crypto.randomUUID(),
      searchDurationMs: Math.round(performance.now() - startTime),
    }
  }

  // HNSW グラフの IndexedDB 保存 (定期的スナップショット)
  private async saveGraphSnapshot(): Promise<void> {
    // 1000 挿入ごとに保存 (頻度調整可能)
    const nodes = this.hnsw!.exportNodes()
    const tx = this.db!.transaction('hnsw-graph', 'readwrite')
    for (const [nodeId, data] of nodes) {
      tx.objectStore('hnsw-graph').put(data)
    }
    await tx.done
  }
}
```

## HNSWIndex (Pure TypeScript 実装)

`packages/node/src/vector-store/HNSWIndex.ts`:

```typescript
export class HNSWIndex {
  private nodes: Map<number, HNSWNode> = new Map()
  private docIdMap: Map<string, number> = new Map()  // docId → nodeId
  private enterPoint: number | null = null
  private nextNodeId = 0

  constructor(
    private dimensions: number,
    private metric: 'cosine' | 'l2' = 'cosine',
    private M: number = 16,
    private efConstruction: number = 200,
    private maxLevel: number = 0,
  ) {}

  insert(docId: string, vector: Float32Array): void {
    const nodeId = this.nextNodeId++
    const level = this.randomLevel()
    const node: HNSWNode = {
      id: nodeId,
      docId,
      vector,
      level,
      neighbors: new Map(),  // level → neighborIds[]
    }

    this.nodes.set(nodeId, node)
    this.docIdMap.set(docId, nodeId)

    if (this.maxLevel < level) {
      this.maxLevel = level
    }

    if (this.enterPoint === null) {
      this.enterPoint = nodeId
      return
    }

    // HNSW insert algorithm (simplified)
    let currNode = this.nodes.get(this.enterPoint)!
    let currDist = this.distance(vector, currNode.vector)

    // Top-level traversal
    for (let l = this.maxLevel; l > level; l--) {
      let changed = true
      while (changed) {
        changed = false
        const neighbors = currNode.neighbors.get(l) || []
        for (const nId of neighbors) {
          const nNode = this.nodes.get(nId)
          if (!nNode) continue
          const d = this.distance(vector, nNode.vector)
          if (d < currDist) {
            currDist = d
            currNode = nNode
            changed = true
          }
        }
      }
    }

    // Insert at all levels up to `level`
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const candidates = this.searchLayer(vector, currNode, l, this.efConstruction)
      const selected = this.selectNeighbors(candidates, this.M)

      const neighbors = currNode.neighbors.get(l) || []
      for (const s of selected) {
        neighbors.push(s.nodeId)
      }
      currNode.neighbors.set(l, neighbors)

      // bidirectional connection
      for (const s of selected) {
        const sNode = this.nodes.get(s.nodeId)
        if (sNode) {
          const sNeighbors = sNode.neighbors.get(l) || []
          sNeighbors.push(nodeId)
          sNode.neighbors.set(l, sNeighbors.slice(-this.M))
        }
      }
    }

    if (level > this.maxLevel) {
      this.enterPoint = nodeId
      this.maxLevel = level
    }
  }

  search(query: Float32Array, k: number): SearchResult[] {
    if (this.nodes.size === 0) return []
    let currNode = this.nodes.get(this.enterPoint!)!
    let currDist = this.distance(query, currNode.vector)

    // Top-level traversal
    for (let l = this.maxLevel; l > 0; l--) {
      let changed = true
      while (changed) {
        changed = false
        const neighbors = currNode.neighbors.get(l) || []
        for (const nId of neighbors) {
          const nNode = this.nodes.get(nId)
          if (!nNode) continue
          const d = this.distance(query, nNode.vector)
          if (d < currDist) {
            currDist = d
            currNode = nNode
            changed = true
          }
        }
      }
    }

    // Level 0 search
    const candidates = this.searchLayer(query, currNode, 0, k)
    return candidates
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k)
      .map(c => {
        const node = this.nodes.get(c.nodeId)!
        return { docId: node.docId, distance: c.distance, metadata: {} }
      })
  }

  private searchLayer(
    query: Float32Array,
    entry: HNSWNode,
    level: number,
    ef: number,
  ): Candidate[] {
    const visited = new Set<number>([entry.id])
    const candidates: Candidate[] = [{ nodeId: entry.id, distance: this.distance(query, entry.vector) }]
    const result: Candidate[] = [...candidates]
    const distMap = new Map<number, number>()
    distMap.set(entry.id, candidates[0].distance)

    while (candidates.length > 0) {
      // Find nearest candidate
      let nearestIdx = 0
      for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].distance < candidates[nearestIdx].distance) {
          nearestIdx = i
        }
      }
      const nearest = candidates[nearestIdx]

      // Find farthest in result
      const farthestDist = result.length > 0
        ? Math.max(...result.map(r => r.distance))
        : 0

      if (nearest.distance > farthestDist) break

      candidates.splice(nearestIdx, 1)
      const node = this.nodes.get(nearest.nodeId)
      if (!node) continue

      const neighbors = node.neighbors.get(level) || []
      for (const nId of neighbors) {
        if (visited.has(nId)) continue
        visited.add(nId)
        const nNode = this.nodes.get(nId)
        if (!nNode) continue
        const d = this.distance(query, nNode.vector)
        distMap.set(nId, d)

        const farthestInResult = result.length > 0
          ? Math.max(...result.map(r => r.distance))
          : Infinity

        if (result.length < ef || d < farthestInResult) {
          candidates.push({ nodeId: nId, distance: d })
          result.push({ nodeId: nId, distance: d })
          if (result.length > ef) {
            result.sort((a, b) => b.distance - a.distance)
            result.pop()
          }
        }
      }
    }

    result.sort((a, b) => a.distance - b.distance)
    return result.slice(0, ef)
  }

  private selectNeighbors(candidates: Candidate[], M: number): Candidate[] {
    return candidates.sort((a, b) => a.distance - b.distance).slice(0, M)
  }

  private distance(a: Float32Array, b: Float32Array): number {
    if (this.metric === 'cosine') {
      let dot = 0, na = 0, nb = 0
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
      }
      return 1 - (dot / (Math.sqrt(na) * Math.sqrt(nb)))
    }
    // L2
    let sum = 0
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] - b[i]) ** 2
    }
    return Math.sqrt(sum)
  }

  private randomLevel(): number {
    // Geometric distribution for level
    let level = 0
    while (Math.random() < 0.5 && level < 16) level++
    return level
  }

  size(): number { return this.nodes.size }
}
```

## VectorIndex Durable Object

`packages/worker/src/worker/VectorIndex.ts`:

```typescript
import { DurableObject } from 'cloudflare:workers'

interface NodeShardInfo {
  nodeId: string
  rangeStart: number
  rangeEnd: number
  vectorCount: number
  lastHeartbeat: number
}

interface ShardAssignment {
  rangeStart: number
  rangeEnd: number
  nodeIds: string[]  // レプリケーション M=3
}

export class VectorIndex extends DurableObject {
  private shards = new Map<string, ShardAssignment>()  // "start-end" → ShardAssignment
  private nodes = new Map<string, NodeShardInfo>()

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/register-storage-node') {
      const { nodeId, capabilities } = await request.json() as {
        nodeId: string
        capabilities: string[]
      }
      const result = await this.registerStorageNode(nodeId)
      return Response.json(result)
    }

    if (url.pathname === '/unregister-storage-node') {
      const { nodeId } = await request.json() as { nodeId: string }
      await this.unregisterStorageNode(nodeId)
      return new Response('OK')
    }

    if (url.pathname === '/query-nodes') {
      const nodes = Array.from(this.nodes.values())
      return Response.json({ nodes })
    }

    if (url.pathname === '/get-shard') {
      const { shardKey } = await request.json() as { shardKey: string }
      const assignment = this.getShardAssignment(parseInt(shardKey, 10))
      return Response.json({ assignment })
    }

    return new Response('Not Found', { status: 404 })
  }

  private async registerStorageNode(nodeId: string): Promise<{
    rangeStart: number
    rangeEnd: number
  }> {
    const totalShards = 65536
    const nodeCount = this.nodes.size + 1
    const shardSize = Math.floor(totalShards / nodeCount)

    // Calculate new shard ranges
    const nodeIndex = this.nodes.size
    const rangeStart = nodeIndex * shardSize
    const rangeEnd = (nodeIndex + 1) * shardSize - 1

    this.nodes.set(nodeId, {
      nodeId,
      rangeStart,
      rangeEnd,
      vectorCount: 0,
      lastHeartbeat: Date.now(),
    })

    return { rangeStart, rangeEnd }
  }

  private async unregisterStorageNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) return
    this.nodes.delete(nodeId)

    // Notify surviving nodes of shard redistribution
    // (re-crawl will repopulate lost vectors)
  }

  private getShardAssignment(shardKey: number): ShardAssignment | null {
    for (const [, assignment] of this.shards) {
      if (shardKey >= assignment.rangeStart && shardKey <= assignment.rangeEnd) {
        return assignment
      }
    }
    return null
  }
}
```

## VectorIndex と NodeManager の連携

NodeManager の `registerNode` に storage 対応を追加：

```typescript
// NodeManager.ts 内
async registerNode(ws: WebSocket, nodeId: string, capabilities: WorkloadType[]) {
  // 既存の処理...

  if (capabilities.includes('vector-store')) {
    const vectorIndexId = this.env.VECTOR_INDEX.idFromName('global-vector-index')
    const vectorIndex = this.env.VECTOR_INDEX.get(vectorIndexId)
    const shardInfo = await vectorIndex.fetch(
      new Request('http://internal/register-storage-node', {
        method: 'POST',
        body: JSON.stringify({ nodeId, capabilities }),
      }),
    )
    const { rangeStart, rangeEnd } = await shardInfo.json()

    // ノードにシャード範囲を通知
    ws.send(JSON.stringify({
      type: 'shard-assign',
      rangeStart,
      rangeEnd,
    }))
  }
}
```

## ノード能力に基づくタスク割り当て

| シナリオ | ノード能力 | 割り当て workload |
|---|---|---|
| 通常ノード (低スペック) | web-crawl | クロールのみ |
| 高性能ノード + 同意 | web-crawl, vector-embed, vector-store, vector-query | フルセット |
| ストレージ特化 | vector-store, vector-query | ベクトル保存・検索のみ |
