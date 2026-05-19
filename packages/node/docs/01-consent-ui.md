# 01. 同意UIコンポーネント

## 概要

Cookie同意バナーと同じ文脈で、ユーザーにノード参加を促すUIを表示する。
**Shadow DOMで実装し、サイト側のCSSと完全に分離する。**

## 表示タイミング

1. `initFlaxiaNode()` 呼び出し時にlocalStorageを確認
2. 同意済み（かつ有効期限内）→ UIを表示せずそのままノード接続
3. 未同意または期限切れ → 同意UIを表示

## UIのコピー（デフォルト）

```
┌─────────────────────────────────────────┐
│ 🤝 {brandName} の運営に協力しませんか？ │
│                                         │
│ 滞在中、動画再生と同程度のCPU負荷      │
│ （最大15%）をお借りします。            │
│ データは送信されません。               │
│                                         │
│  [協力する]  [今回はやめておく]         │
└─────────────────────────────────────────┘
```

## 重要な言語設計方針

- **「CPU」という言葉は使わない**（怖い印象を与える）
  → 「動画再生と同程度の負荷」に言い換える
- **「データは送信されません」を明記する**（プライバシー懸念の先手）
- **「今回はやめておく」**（「拒否」ではなく柔らかく）
- 「協力する」を選んだ場合は「ありがとうございます」と表示してから消える

## localStorageのキー設計

```typescript
const CONSENT_KEY = 'flaxia-crowd-consent'

type ConsentRecord = {
  agreed: boolean
  timestamp: number   // unixtime ms
  expiresAt: number   // unixtime ms
}
```

## Shadow DOM実装方針

```typescript
class ConsentUI extends HTMLElement {
  private shadow: ShadowRoot

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'closed' })
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>/* すべてのスタイルをここに閉じ込める */</style>
      <div class="flaxia-consent">...</div>
    `
  }
}

customElements.define('flaxia-consent', ConsentUI)
```

## アクセシビリティ要件

- `role="dialog"`, `aria-modal="true"` を付与
- フォーカストラップを実装（Tabキーがバナー外に出ない）
- `Escape` キーで「今回はやめておく」と同じ動作
- `prefers-reduced-motion` に対応（アニメーション無効化）

## ポジション指定

```typescript
const POSITION_STYLES = {
  'bottom-right': 'bottom: 20px; right: 20px;',
  'bottom-left':  'bottom: 20px; left: 20px;',
  'top-right':    'top: 20px; right: 20px;',
  'top-left':     'top: 20px; left: 20px;',
}
```

## イベント発火

```typescript
// 同意した場合
instance.emit('consent', { agreed: true })

// 断った場合
instance.emit('consent', { agreed: false })
```
