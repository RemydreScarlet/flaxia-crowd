# Flaxia Crowd web-crawl Workload 設計

## 概要

Flaxia Crowd に新 workload `web-crawl` を追加し、一般ウェブサイト訪問者のブラウザノードを活用した分散クローラーを実現します。

## 追加する型定義

`packages/sdk/src/types.ts` に以下を追加：

```typescript
// WorkloadType ユニオンに追加
export type WorkloadType =
  | 'ai-inference'
  | 'image-process'
  | 'file-convert'
  | 'container'
  | 'web-crawl'        // ★ 新規
  | 'vector-embed'     // ★ 新規
  | 'vector-store'     // ★ 新規
  | 'vector-query'     // ★ 新規

// --- Web Crawl ---
export interface WebCrawlPayload {
  /** クロール対象 URL */
  url: string;
  /** 最大深度 (0 = 同一ページのみ, default: 0) */
  maxDepth?: number;
  /** CSS セレクタで対象要素を指定 (指定時はそこのみ抽出) */
  extractSelectors?: string[];
  /** robots.txt を尊重するか (default: true) */
  respectRobotsTxt?: boolean;
  /** 取得するコンテンツ形式 (default: 'text') */
  extractFormat?: 'text' | 'markdown' | 'html';
}

export interface WebCrawlResult {
  /** クロールした URL (リダイレクト後) */
  url: string;
  /** ページタイトル */
  title: string;
  /** 抽出されたテキスト本文 */
  content: string;
  /** 抽出フォーマット (text / markdown / html) */
  format: string;
  /** メタデータ */
  metadata: {
    /** Content-Type ヘッダー値 */
    contentType: string;
    /** コンテンツ長 (bytes) */
    contentLength: number;
    /** フェッチ所要時間 (ms) */
    fetchDurationMs: number;
    /** ステータスコード */
    statusCode: number;
  };
  /** ページ内リンク一覧 (同一オリジン) */
  links: string[];
  /** robots.txt の Crawl-Delay 値 (秒) */
  crawlDelay?: number;
}

// --- Vector Embedding ---
export interface VectorEmbedPayload {
  /** 埋め込み対象テキスト */
  text: string;
  /** モデル指定 (default: 'Qwen/Qwen3-Embedding-0.6B') */
  model?: string;
  /** チャンク offset (複数チャンクからなるドキュメント用) */
  chunkIndex?: number;
  /** 元ドキュメント ID */
  docId?: string;
}

export interface VectorEmbedResult {
  /** ベクトル配列 (1024 次元) */
  vector: number[];
  /** 使用モデル */
  model: string;
  /** 次元数 */
  dimensions: number;
  /** 処理時間 (ms) */
  durationMs: number;
}

// --- Vector Store ---
export interface VectorStorePayload {
  /** ドキュメント ID */
  docId: string;
  /** ベクトル配列 */
  vector: number[];
  /** 検索結果表示用メタデータ */
  metadata: {
    title: string;
    url: string;
    snippet: string;
    [key: string]: unknown;
  };
  /** Orchestrator から割り当てられたシャードキー */
  shardKey: string;
}

export interface VectorStoreResult {
  /** 保存成功 */
  stored: boolean;
  /** 保存先ノード ID */
  nodeId: string;
  /** 保存後ローカルベクトル総数 */
  totalVectors: number;
}

// --- Vector Query ---
export interface VectorQueryPayload {
  /** クエリベクトル */
  queryVector: number[];
  /** 取得件数 (default: 10) */
  topK: number;
}

export interface VectorQueryResult {
  /** 検索結果 */
  results: Array<{
    docId: string;
    score: number;
    metadata: {
      title: string;
      url: string;
      snippet: string;
    };
  }>;
  /** 実行ノード ID */
  nodeId: string;
  /** ローカル検索所要時間 */
  searchDurationMs: number;
}

// WebCrawlPayload を TaskPayload ユニオンに追加
export type TaskPayload =
  | AiInferencePayload
  | ImageProcessPayload
  | FileConvertPayload
  | ContainerPayload
  | WebCrawlPayload        // ★
  | VectorEmbedPayload     // ★
  | VectorStorePayload     // ★
  | VectorQueryPayload;    // ★
```

## web-crawl workload 実装

`packages/node/src/workloads/web-crawl.ts`:

```typescript
export async function handleWebCrawl(
  payload: WebCrawlPayload,
): Promise<WebCrawlResult> {
  const { url, extractSelectors, respectRobotsTxt = true, extractFormat = 'text' } = payload
  const startTime = performance.now()

  // robots.txt 確認 (同期限定、cache 利用)
  if (respectRobotsTxt) {
    const allowed = await checkRobotsTxt(url)
    if (!allowed) throw new Error(`Blocked by robots.txt: ${url}`)
  }

  // fetch
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'VectoriaCrawler/1.0 (FlaxiaCrowd)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  })

  const html = await response.text()
  const duration = performance.now() - startTime

  // DOM パース (DOMParser は WebWorker 内で利用可)
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // タイトル抽出
  const title = doc.querySelector('title')?.textContent?.trim() || url

  // コンテンツ抽出
  let content = ''
  if (extractSelectors && extractSelectors.length > 0) {
    content = extractBySelectors(doc, extractSelectors)
  } else {
    content = extractMainContent(doc, extractFormat)
  }

  // リンク抽出 (同一オリジン)
  const links = extractSameOriginLinks(doc, url)

  // robots meta タグ確認
  const robotsMeta = doc.querySelector('meta[name="robots"]')?.getAttribute('content')
  const crawlDelay = robotsMeta?.includes('nofollow') ? undefined : undefined

  return {
    url: response.url,
    title,
    content,
    format: extractFormat,
    metadata: {
      contentType: response.headers.get('content-type') || '',
      contentLength: html.length,
      fetchDurationMs: Math.round(duration),
      statusCode: response.status,
    },
    links,
  }
}

function extractBySelectors(doc: Document, selectors: string[]): string {
  const parts: string[] = []
  for (const sel of selectors) {
    doc.querySelectorAll(sel).forEach(el => {
      const text = (el as HTMLElement).textContent?.trim()
      if (text) parts.push(text)
    })
  }
  return parts.join('\n\n')
}

function extractMainContent(doc: Document, format: string): string {
  // 簡易的なメインコンテンツ抽出:
  // 1. <article> 優先
  // 2. <main> または [role="main"]
  // 3. <body> からナビゲーション・フッター・ヘッダー除去
  const article = doc.querySelector('article')
  if (article) return cleanText(article.textContent || '', format)

  const main = doc.querySelector('main, [role="main"]')
  if (main) return cleanText(main.textContent || '', format)

  // body から javascript/style 除去
  const body = doc.body
  if (!body) return ''
  const clone = body.cloneNode(true) as HTMLElement
  const removeSelectors = ['script', 'style', 'nav', 'header', 'footer', 'aside']
  for (const sel of removeSelectors) {
    clone.querySelectorAll(sel).forEach(el => el.remove())
  }
  return cleanText(clone.textContent || '', format)
}

function cleanText(text: string, format: string): string {
  return text
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n')
}

function extractSameOriginLinks(doc: Document, baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const links = new Set<string>()
  doc.querySelectorAll('a[href]').forEach(a => {
    try {
      const href = (a as HTMLAnchorElement).href
      const url = new URL(href, baseUrl)
      if (url.origin === base.origin && !url.hash) {
        links.add(url.href)
      }
    } catch {}
  })
  return Array.from(links).slice(0, 100) // 最大100リンク
}
```

## robots.txt 対応

`packages/node/src/workloads/robots-cache.ts`:

```typescript
// robots.txt のキャッシュと確認 (IndexedDB 利用)
// 同一オリジン内でキャッシュ共有、有効期限24h

const ROBOTS_CACHE_DB = 'flaxia-robots-cache'
const ROBOTS_CACHE_EXPIRY = 24 * 60 * 60 * 1000 // 24h

interface RobotsCacheEntry {
  allowedPaths: string[]
  disallowedPaths: string[]
  crawlDelay: number
  fetchedAt: number
}

async function checkRobotsTxt(url: string): Promise<boolean> {
  const parsed = new URL(url)
  const origin = parsed.origin
  const path = parsed.pathname

  const cached = await getRobotsCache(origin)
  if (cached) {
    return isPathAllowed(path, cached)
  }

  try {
    const robotsUrl = `${origin}/robots.txt`
    const res = await fetch(robotsUrl)
    if (res.status === 404) return true // robots.txt なし = 全面許可

    const text = await res.text()
    const entry = parseRobotsTxt(text)
    entry.fetchedAt = Date.now()
    await setRobotsCache(origin, entry)
    return isPathAllowed(path, entry)
  } catch {
    return true // エラー時は安全側に倒す
  }
}

function parseRobotsTxt(text: string): Omit<RobotsCacheEntry, 'fetchedAt'> {
  // 簡易パーサー: User-agent: * のみ対象
  const lines = text.split('\n')
  const allowedPaths: string[] = []
  const disallowedPaths: string[] = []
  let crawlDelay = 0
  let applicable = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('User-agent:')) {
      const ua = trimmed.split(':')[1]?.trim() || ''
      applicable = ua === '*' || ua.toLowerCase().includes('vectoria')
    } else if (applicable) {
      if (trimmed.startsWith('Disallow:')) {
        disallowedPaths.push(trimmed.split(':')[1]?.trim() || '')
      } else if (trimmed.startsWith('Allow:')) {
        allowedPaths.push(trimmed.split(':')[1]?.trim() || '')
      } else if (trimmed.startsWith('Crawl-Delay:')) {
        crawlDelay = parseInt(trimmed.split(':')[1]?.trim() || '0', 10)
      }
    }
  }

  return { allowedPaths, disallowedPaths, crawlDelay }
}

function isPathAllowed(path: string, entry: RobotsCacheEntry): boolean {
  // Allow が優先、次に Disallow
  for (const allowed of entry.allowedPaths) {
    if (path.startsWith(allowed)) return true
  }
  for (const disallowed of entry.disallowedPaths) {
    if (disallowed === '' || disallowed === '/') return false
    if (path.startsWith(disallowed)) return false
  }
  return true
}
```

## Flaxia Node 拡張

`packages/node/src/worker/main.worker.ts` にケース追加：

```typescript
self.onmessage = async (e: MessageEvent) => {
  const { id, workload, payload } = e.data
  const heartbeat = setInterval(() => {
    self.postMessage({ id, type: 'heartbeat' })
  }, 10000)

  try {
    let result
    switch (workload as WorkloadType) {
      // 既存ケース...

      case 'web-crawl':
        const { handleWebCrawl } = await import('../workloads/web-crawl')
        result = await handleWebCrawl(payload)
        break

      case 'vector-embed':
        const { handleVectorEmbed } = await import('../workloads/vector-embed')
        result = await handleVectorEmbed(payload)
        break

      case 'vector-store':
        const { handleVectorStore } = await import('../workloads/vector-store')
        result = await handleVectorStore(payload)
        break

      case 'vector-query':
        const { handleVectorQuery } = await import('../workloads/vector-query')
        result = await handleVectorQuery(payload)
        break
    }

    self.postMessage({ id, type: 'done', result })
  } catch (err) {
    self.postMessage({
      id, type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
```

## クロールポリシー

| 項目 | 設定 | 理由 |
|---|---|---|
| User-Agent | `VectoriaCrawler/1.0 (FlaxiaCrowd)` | 識別可能にする |
| 同時接続数 | ノードあたり1 | ブラウザ負荷軽減 |
| リトライ | 最大2回 (3xx/5xx) | 一時的エラー対策 |
| タイムアウト | 30秒 | ブラウザタブ占有防止 |
| 最大ページサイズ | 5MB | メモリ制限 |
| robots.txt | 尊重 (デフォルト on) | 倫理的クローリング |
| Crawl-Delay | 尊重 | 対象サーバー負荷軽減 |
| 同一ドメイン同時 | 1ノードのみ | orchestrator が制御 |
