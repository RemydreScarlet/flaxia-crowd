# UI デザイン仕様

## 概要

Google 風のミニマルな検索インターフェースを Next.js App Router + Tailwind CSS で実装します。

## ページ構成

```
pages/
├── app/
│   ├── layout.tsx          # ルートレイアウト (メタデータ、フォント)
│   ├── page.tsx            # トップページ (検索バー)
│   ├── search/
│   │   └── page.tsx        # 検索結果ページ (/search?q=...)
│   ├── api/
│   │   ├── search/route.ts  # 検索 API
│   │   ├── index/route.ts   # インデックス登録 API
│   │   └── crawl/route.ts   # クロールリクエスト API
│   └── loading.tsx          # ローディングスケルトン
└── components/
    ├── SearchBar.tsx         # 検索バーコンポーネント
    ├── SearchResult.tsx      # 検索結果カード
    ├── SearchSuggestions.tsx # サジェスト (Phase 2)
    └── ThemeToggle.tsx       # ダークモード切替
```

## トップページ

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                                                     │
│                                                     │
│              V                                      │
│          ████████                                    │
│         ██ Vectoria ██    ← ロゴ (SVG)              │
│          ████████                                    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │                                             │    │
│  │    🔍  Search or type URL...                │    │ ← 検索バー
│  │                                             │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│         [ Vectoria Search ]  [ I'm Feeling Lucky ]  │ ← ボタン
│                                                     │
│                                                     │
│  Flaxia Crowd 分散検索エンジン  │  プライバシー      │ ← フッター
└─────────────────────────────────────────────────────┘
```

## 検索結果ページ

```
┌─────────────────────────────────────────────────────┐
│  Vectoria  ┌─────────────────────────────┐  [🌙]    │ ← トグル + 結果内検索バー
│            │  query                      │          │
│            └─────────────────────────────┘          │
│                                                     │
│  約 42 件 (0.31 秒)                                 │ ← ステータス
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟢 https://example.com/page-1                  │ │ ← 結果カード
│  │ ## Page Title 1                               │ │
│  │ This is the snippet of the page that matches...│ │
│  │ <mark>query</mark> is highlighted in context... │ │
│  │ 類似度: ████████░░ 85%                          │ │ ← 類似度バー
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟡 https://example.com/page-2                  │ │
│  │ ## Page Title 2                               │ │
│  │ Another matching snippet from the page...      │ │
│  │ 類似度: ██████░░░░ 62%                          │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟠 https://example.com/page-3                  │ │
│  │ 類似度: ████░░░░░░ 41%                          │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  [1] [2] [3] [4] [5] [次へ]                        │ ← ページネーション
└─────────────────────────────────────────────────────┘
```

## カラースキーム

### ライトモード

| 要素 | カラー |
|---|---|
| 背景 | `#ffffff` |
| 検索バー背景 | `#f1f3f4` (hover: `#e8eaed`) |
| 検索バーボーダー | `#dfe1e5` (focus: `#4285f4`) |
| リンク | `#1a0dab` |
| URL | `#006621` |
| タイトル | `#1a0dab` |
| スニペット | `#545454` |
| 類似度バー | `#4285f4` (高) → `#ea4335` (低) グラデーション |

### ダークモード

| 要素 | カラー |
|---|---|
| 背景 | `#202124` |
| 検索バー背景 | `#303134` (hover: `#3c4043`) |
| 検索バーボーダー | `#5f6368` (focus: `#8ab4f8`) |
| リンク | `#8ab4f8` |
| URL | `#bdc1c6` |
| タイトル | `#8ab4f8` |
| スニペット | `#bdc1c6` |

## コンポーネント仕様

### SearchBar

```typescript
'use client'
interface SearchBarProps {
  initialQuery?: string
  autoFocus?: boolean
  onSearch: (query: string) => void
  // Google風:
  // - Enter or 検索ボタンで onSearch
  // - 入力中は debounce 500ms でサジェスト (Phase 2)
  // - フォーカス時: 枠線青、shadow
}
```

### SearchResult

```typescript
interface SearchResultProps {
  url: string
  title: string
  snippet: string           // query マッチ箇所は <mark> でハイライト
  score: number             // 0.0 - 1.0
  favicon?: string          // https://www.google.com/s2/favicons?domain=example.com
}
```

### 類似度スコアバー

```typescript
function ScoreBar({ score }: { score: number }) {
  // 0.0: 赤 (#ea4335) → 0.5: 黄 (#fbbc04) → 1.0: 緑 (#34a853)
  const color = score > 0.6 ? '#34a853' : score > 0.3 ? '#fbbc04' : '#ea4335'
  return (
    <div className="flex items-center gap-1 text-xs text-gray-500">
      <div className="w-20 h-2 bg-gray-200 rounded-full">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${score * 100}%`, backgroundColor: color }}
        />
      </div>
      <span>{Math.round(score * 100)}%</span>
    </div>
  )
}
```

## レスポンシブ

| ブレークポイント | レイアウト |
|---|---|
| ≥ 1024px | デスクトップ: 検索バー中央、結果左寄せ |
| 768-1023px | タブレット: 標準レイアウト |
| < 768px | モバイル: 検索バー全幅、結果パディング縮小 |

## SSR/ISR

| ページ | レンダリング戦略 |
|---|---|
| トップページ | Static (SSG) |
| 検索結果 | Dynamic (SSR) — クエリごとに最新結果 |
| Crawl 結果ページ | Dynamic (SSR) |

## インタラクション

| アクション | 動作 |
|---|---|
| 検索バー Enter / 検索ボタン | `router.push(/search?q=...)` + <SearchBar> 内部で onSearch |
| 結果クリック | window.open(url) or router.push(url) |
| I'm Feeling Lucky | 類似度最高の結果に直接遷移 |
| ダークモード切替 | localStorage 保存、`<html class="dark">` |
| ページネーション | `router.push(/search?q=...&page=N)` |
