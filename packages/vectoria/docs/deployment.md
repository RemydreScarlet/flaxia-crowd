# デプロイガイド

## 概要

Vectoria は以下の Cloudflare サービス上にデプロイします：

| コンポーネント | サービス | 費用 |
|---|---|---|
| Next.js フロントエンド | Cloudflare Pages | 無料 |
| Flaxia Worker (orchestrator) | Cloudflare Workers | 無料枠内 |
| Durable Objects (NodeManager, TaskQueue, VectorIndex) | Cloudflare Workers DO | 無料枠内 |
| Flaxia Crowd ノード | 訪問者ブラウザ | 無料 (Flaxia Crowd モデル) |

## 1. モノレポの準備

```bash
# 依存関係インストール
cd flaxia-crowd
npm install

# 全パッケージビルド
npm run build

# Vectoria 開発サーバー起動
npm run dev --workspace=packages/vectoria
```

## 2. Flaxia Worker デプロイ

### wrangler.toml

`packages/worker/wrangler.toml`:

```toml
name = "flaxia-crowd-worker"
main = "src/index.ts"
compatibility_date = "2026-05-28"
compatibility_flags = ["nodejs_compat"]

[[durable_objects.bindings]]
name = "NODE_MANAGER"
class_name = "NodeManager"

[[durable_objects.bindings]]
name = "TASK_QUEUE"
class_name = "TaskQueue"

[[durable_objects.bindings]]
name = "VECTOR_INDEX"
class_name = "VectorIndex"

[[migrations]]
tag = "v1"
new_classes = ["NodeManager", "TaskQueue"]

[[migrations]]
tag = "v2"
new_classes = ["VectorIndex"]
```

```bash
# デプロイ
cd packages/worker
npx wrangler deploy

# 環境変数設定
npx wrangler secret put FLAXIA_API_KEY
```

### 注意点

- Durable Objects の `VectorIndex` クラスを migration v2 で追加
- 既存環境へのデプロイ時は段階的 migration が必要
- タグ `v1` → `v2` の順に適用

## 3. Next.js (Vectoria) デプロイ

### Cloudflare Pages へのデプロイ

```bash
cd packages/vectoria

# Next.js ビルド
npm run build

# Cloudflare Pages デプロイ
npx wrangler pages deploy .next
```

または GitHub 連携 (推奨):

1. Cloudflare Dashboard → Pages → Create a project
2. GitHub リポジトリ `flaxia-crowd` を接続
3. Build settings:
   - Build command: `cd packages/vectoria && npm run build`
   - Build output: `packages/vectoria/.next`
   - Root directory: `packages/vectoria`
4. Environment variables:
   - `FLAXIA_API_KEY`: Flaxia Crowd API key
   - `FLAXIA_WORKER_URL`: Workers デプロイ先 URL

### wrangler.toml (Pages)

```toml
pages_project_name = "vectoria"

[[pages_routes]]
pattern = "/api/*"
execution = "pages-function"
```

## 4. Flaxia Crowd Node SDK 埋め込み

Vectoria サイト自体も Flaxia Crowd のノード提供者となります：

```typescript
// packages/vectoria/src/lib/flaxia-node.ts
import { initFlaxiaNode } from '@flaxia/node'

export function initVectoriaNode() {
  initFlaxiaNode({
    orchestratorUrl: process.env.NEXT_PUBLIC_FLAXIA_WORKER_URL!,
    siteId: 'vectoria',
    consent: {
      brandName: 'Vectoria Search',
      position: 'bottom-right',
      accentColor: '#4285f4',
    },
  })
}
```

```typescript
// packages/vectoria/src/app/layout.tsx
'use client'
import { useEffect } from 'react'
import { initVectoriaNode } from '@/lib/flaxia-node'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initVectoriaNode()
  }, [])

  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
```

## 5. Flaxia SDK を使用した API Route

```typescript
// packages/vectoria/src/app/api/search/route.ts
import { FlaxiaClient } from '@flaxia/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new FlaxiaClient({
  apiKey: process.env.FLAXIA_API_KEY!,
  endpoint: process.env.FLAXIA_WORKER_URL!,
})

export async function POST(request: NextRequest) {
  const { q, topK = 10 } = await request.json()

  if (!q || typeof q !== 'string') {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  try {
    // Step 1: クエリを embedding
    const embedTask = await client.submit({
      workload: 'vector-embed',
      payload: { text: q },
      timeoutMs: 30000,
    })
    const { vector } = embedTask.result as { vector: number[] }

    // Step 2: ベクトル検索
    const queryTask = await client.submit({
      workload: 'vector-query',
      payload: { queryVector: vector, topK },
      timeoutMs: 30000,
    })
    const { results } = queryTask.result as {
      results: Array<{
        docId: string
        score: number
        metadata: { title: string; url: string; snippet: string }
      }>
    }

    return NextResponse.json({
      query: q,
      totalResults: results.length,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 503 },
    )
  }
}
```

## 6. 環境変数一覧

| 変数 | 必須 | 説明 |
|---|---|---|
| `FLAXIA_API_KEY` | Yes | Flaxia Crowd API キー |
| `FLAXIA_WORKER_URL` | Yes | Flaxia Worker の URL |
| `NEXT_PUBLIC_FLAXIA_WORKER_URL` | Yes | ブラウザからアクセス可能な Worker URL |

## 7. 開発環境

```bash
# 全パッケージの開発サーバー並列起動
npm run dev

# 各パッケージ個別起動
npm run dev:worker     # Worker (wrangler dev)
npm run dev:node       # Node SDK (Vite)
npm run -w packages/vectoria dev  # Vectoria UI (Next.js)

# テスト
npm run test
npm run -w packages/vectoria test
```

## 8. 運用モニタリング

### Workers ダッシュボード

Cloudflare Dashboard → Workers & Pages → flaxia-crowd-worker:

- リクエスト数/秒
- Durable Object の状態
- エラーレート

### DO ストレージ使用量

VectorIndex DO のストレージはシャードメタデータのみなのでごく小規模 (数十KB〜数MB)。

### ノード数監視

`GET /api/admin/stats` でアクティブノード数を確認。

### アラート (Phase 2)

| 条件 | アクション |
|---|---|
| storage node 数 < 3 | 通知 (インデックス不可) |
| ノード数 = 0 | 重大アラート (検索不可) |
| 検索成功率 < 90% | 通知 |

## 9. トラブルシューティング

| 問題 | 原因 | 対処 |
|---|---|---|
| 検索結果が空 | storage node なし | Vectoria サイトへのトラフィック増加待ち |
| クロールが timeout | 対象サーバー応答なし | リトライ or クロールキュー確認 |
| DO migration エラー | wrangler タグ不整合 | `wrangler deploy --dry-run` で確認 |
| Transformers.js エラー | WASM 未対応ブラウザ | `device: 'wasm'` でフォールバック確認 |
