# API リファレンス

Vectoria は Next.js API Routes を通じて以下のエンドポイントを提供します。

## 検索 API

### `POST /api/search`

クエリを受け取り、分散ベクトル検索を実行します。

```http
POST /api/search
Content-Type: application/json

{
  "q": "hello world",
  "topK": 10,
  "page": 1
}
```

#### レスポンス

```json
{
  "query": "hello world",
  "totalResults": 42,
  "searchDurationMs": 312,
  "results": [
    {
      "docId": "a1b2c3d4:0",
      "score": 0.85,
      "metadata": {
        "title": "Hello World Page",
        "url": "https://example.com/hello",
        "snippet": "This page explains hello world in detail..."
      }
    }
  ]
}
```

#### エラー

```json
{
  "error": "No storage nodes available",
  "query": "hello world"
}
```

---

### `POST /api/search/hybrid` (Phase 2)

ベクトル検索 + キーワード検索のハイブリッド検索 (TF-IDF 等、将来拡張)。

---

## インデックス API

### `POST /api/index`

ドキュメントを直接インデックス登録します（クローラーを経由せずに）。

```http
POST /api/index
Content-Type: application/json

{
  "url": "https://example.com/doc",
  "title": "Example Document",
  "content": "Full text content here..."
}
```

#### 内部処理

1. `content` をチャンク分割 (512token)
2. 各チャンクを `vector-embed` workload として submit
3. 得られたベクトルを `vector-store` workload として submit
4. 全チャンク完了後、`200 OK` を返す

```json
{
  "indexed": true,
  "docId": "a1b2c3d4",
  "chunks": 3,
  "indexDurationMs": 1450
}
```

---

### `DELETE /api/index`

ドキュメントをインデックスから削除します。

```http
DELETE /api/index
Content-Type: application/json

{
  "url": "https://example.com/doc"
}
```

```json
{
  "deleted": true,
  "docId": "a1b2c3d4"
}
```

---

## クロール API

### `POST /api/crawl`

クロールリクエストを Flaxia Crowd に投入します。

```http
POST /api/crawl
Content-Type: application/json

{
  "url": "https://example.com",
  "maxDepth": 1,
  "extractSelectors": ["article", "main"],
  "respectRobotsTxt": true
}
```

#### 内部処理

1. Flaxia SDK で `web-crawl` workload submit
2. ノードがクロール完了 → callback 受信
3. 得られた `content` をチャンク → 各チャンクを `vector-embed` submit
4. 各 embedding → `vector-store` submit
5. 全完了後、結果を返す

```json
{
  "crawled": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "linksFound": 5,
  "indexedChunks": 3,
  "totalDurationMs": 3200
}
```

---

### `POST /api/crawl/batch`

複数 URL の一括クロール。

```http
POST /api/crawl/batch
Content-Type: application/json

{
  "urls": [
    "https://example.com/page1",
    "https://example.com/page2",
    "https://example.com/page3"
  ],
  "maxDepth": 0
}
```

```json
{
  "crawled": 3,
  "failed": 0,
  "results": [
    { "url": "https://example.com/page1", "status": "indexed", "durationMs": 1200 },
    { "url": "https://example.com/page2", "status": "indexed", "durationMs": 1500 },
    { "url": "https://example.com/page3", "status": "indexed", "durationMs": 1100 }
  ]
}
```

---

### `GET /api/crawl/:taskId`

クロールタスクの状態確認。

```http
GET /api/crawl/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

```json
{
  "taskId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "processing",
  "url": "https://example.com",
  "createdAt": "2026-05-28T10:00:00Z",
  "estimatedCompletion": "2026-05-28T10:00:10Z"
}
```

---

## 管理 API

### `GET /api/admin/stats`

システム統計情報。

```http
GET /api/admin/stats
```

```json
{
  "totalIndexedDocs": 1234,
  "totalVectors": 3456,
  "activeNodes": {
    "total": 15,
    "storageCapable": 8,
    "crawlCapable": 12
  },
  "shards": {
    "total": 65536,
    "covered": 65536,
    "replicationFactor": 2.5
  }
}
```

---

### `GET /api/admin/nodes`

全ノードの状態一覧。

```http
GET /api/admin/nodes
```

```json
{
  "nodes": [
    {
      "id": "abc-123",
      "status": "idle",
      "capabilities": ["web-crawl", "vector-embed", "vector-store", "vector-query"],
      "cpuLoad": 0.15,
      "vectorCount": 450,
      "shardRange": "0x0000-0x1FFF",
      "connectedAt": "2026-05-28T09:00:00Z"
    }
  ]
}
```

## API エラーレスポンス

| HTTP ステータス | 意味 |
|---|---|
| `200` | 成功 |
| `400` | リクエストパラメータ不正 |
| `404` | タスク/ドキュメントが見つからない |
| `503` | 利用可能なノードがない |

```json
{
  "error": "message",
  "code": "ERROR_CODE"
}
```
