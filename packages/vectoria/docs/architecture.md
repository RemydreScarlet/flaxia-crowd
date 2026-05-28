# アーキテクチャ

## 全体構成

```
                     Cloudflare Workers (Orchestrator)
  ┌───────────────────────────────────────────────────────────────────┐
  │  crowd/index.ts (Hono HTTP + WebSocket)                          │
  │                                                                   │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐       │
  │  │  NodeManager  │  │  TaskQueue   │  │  VectorIndex     │       │
  │  │  (DO)         │  │  (DO)        │  │  (DO) ★新規      │       │
  │  │  接続管理     │  │  タスク管理  │  │  シャード管理    │       │
  │  │  能力管理     │  │  リトライ    │  │  ノードカタログ  │       │
  │  │  負荷分散     │  │  タイムアウト│  │  メトリクス     │       │
  │  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘       │
  └─────────┼─────────────────┼───────────────────┼──────────────────┘
            │                 │                   │
            │   WebSocket     │   HTTP            │   DO Internal RPC
            ▼                 ▼                   ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │  Flaxia Crowd Network (ユーザーブラウザノード群)                   │
  │                                                                    │
  │  Node A ─────────────────────────────────────────────────────┐    │
  │  ├─ WebSocket → NodeManager (常時接続)                       │    │
  │  ├─ WebWorker (タスク実行)                                    │    │
  │  ├─ Workloads:                                                │    │
  │  │   ├─ web-crawl      → HTTP fetch + DOMParser              │    │
  │  │   ├─ vector-embed   → Transformers.js + Qwen3-0.6B ONNX   │    │
  │  │   ├─ vector-store   → IndexedDB + HNSW グラフ書き込み     │    │
  │  │   └─ vector-query   → IndexedDB + HNSW 検索               │    │
  │  └─ IndexedDB "flaxia-vector-store"                           │    │
  │      ├─ vectors    (ObjectStore: docId → {vector, metadata})  │    │
  │      └─ hnsw-graph (ObjectStore: nodeId → {neighbors})        │    │
  └───────────────────────────────────────────────────────────────┘    │
                                                                       │
  Node B (同様、別のシャード範囲を担当)                                │
  Node C (同様)                                                        │
  ...                                                                  │
  └────────────────────────────────────────────────────────────────────┘
            │ callback (task result)
            ▼
  ┌──────────────────────────────────────────────────┐
  │  Vectoria Next.js (Cloudflare Pages)             │
  │                                                   │
  │  ├─ app/page.tsx          → Google風検索UI        │
  │  ├─ app/api/search/route  → /api/search          │
  │  ├─ app/api/index/route   → /api/index           │
  │  ├─ app/api/crawl/route   → /api/crawl           │
  │  └─ lib/flaxia-client.ts  → Flaxia SDK wrapper   │
  │                                                   │
  │  └─ Cloudflare Pages (Edge, 全世界展開)           │
  └──────────────────────────────────────────────────┘
```

## コンポーネント構成図

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Flaxia Crowd Monorepo                          │
│                                                                     │
│  packages/sdk/         packages/node/         packages/worker/      │
│  ┌──────────────┐     ┌──────────────┐      ┌──────────────┐      │
│  │ WorkloadType │◀────│ workloads/   │──────│ NodeManager  │      │
│  │ TaskPayload  │     │  web-crawl   │      │ TaskQueue    │      │
│  │ TaskRecord   │     │  vector-embed│      │ VectorIndex  │      │
│  │ NodeConfig   │     │  vector-store│      │ (DO) ★新規   │      │
│  └──────────────┘     │  vector-query│      └──────────────┘      │
│                        │ vector-store/│                             │
│                        │  HNSWIndex   │                             │
│                        │  IndexedDB   │                             │
│                        └──────────────┘                             │
│                                                                     │
│  packages/vectoria/ ★新規                                          │
│  ┌─────────────────────────────────────────────────┐               │
│  │ Next.js App (Cloudflare Pages)                  │               │
│  │ docs/  設計ドキュメント群                        │               │
│  └─────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

## データフロー (検索時)

```
1. User: "Hello World" を検索
2. Next.js:  /api/search にリクエスト
3. Flaxia SDK: クエリ embedding を Flaxia Crowd に submit
   → vector-embed workload: Qwen3-0.6B → [0.12, -0.03, ...] (1024d)
4. Flaxia SDK: vector-query を全 storage node に submit
   → 各ノード: IndexedDB HNSW 検索 → top-10 返送
5. Flaxia Worker: 結果をマージ・重複除去・ソート → top-10 確定
6. Next.js: Google風UI にレンダリング
```

## データフロー (クロール/インデックス時)

```
1. Vectoria: POST /api/crawl { url: "https://example.com" }
2. Flaxia SDK: web-crawl workload submit
   → ノードA: fetch → DOMParse → title, text, links 抽出 → callback
3. Flaxia SDK (callback受信): text を vector-embed submit
   → ノードB: Qwen3-0.6B → embedding (1024d) → callback
4. Flaxia SDK: vector-store submit
   → ノードC: IndexedDB に保存 + HNSW グラフ更新 → 完了
```

## キー設計判断

| 判断 | 理由 |
|---|---|
| ベクトルストアを P2P 分散に | サーバーコストゼロ、Flaxia Crowd との最大のシナジー |
| VectorIndex DO でシャード管理 | Durable Objects の一貫性保証を活用、軽量メタデータのみ |
| データ消失を許容 | 再クロール前提の設計。耐障害性よりコスト優先 |
| レプリケーション M=3 | ノード離脱時のデータロストリスク低減 |
| Workload を細粒度に分割 | 各ノードの能力に応じた柔軟な割り当て（クロールのみ、ストアのみ等） |
