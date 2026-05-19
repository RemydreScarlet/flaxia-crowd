# Flaxia Crowd

**「サーバーレス・バッチ処理を月額定額で実現する」分散処理ライブラリ。**

一般ウェブサイトの訪問者ブラウザをノードとして活用し、AI推論・画像処理などの非同期バッチ処理を効率的に実行します。

---

## 概要

| 比較項目 | 従来型（AWS/Modal等） | Flaxia Crowd |
|---|---|---|
| コスト | 従量課金・青天井 | **月額定額** |
| 予算 | 予測困難 | **予測可能** |
| スケーラビリティ | サーバー増設 | **サイト訪問者数に連動** |

サーバーを介さないため、従来と根本的に異なる原価構造で提供します。

---

## パッケージ構成

- `@flaxia/sdk`: タスク投入・結果取得用。
- `@flaxia/node`: ブラウザノード提供用SDK。
- `@flaxia/worker`: Cloudflare Workersベースのオーケストレーター。

---

## クイックスタート

### 依頼者

```bash
npm install @flaxia/sdk
```

```typescript
import { FlaxiaClient } from '@flaxia/sdk'

const client = new FlaxiaClient({ apiKey: '...' })

// タスク実行
const result = await client.submit({
  workload: 'ai-inference',
  payload: {
    task: 'text-classification',
    input: 'This product is amazing!',
  },
})
```

### サイトオーナー

```bash
npm install @flaxia/node
```

```typescript
import { initFlaxiaNode } from '@flaxia/node'

initFlaxiaNode({
  orchestratorUrl: 'https://flaxia.app',
  siteId: '...',
  consent: { brandName: 'YourService', position: 'bottom-right' },
})
```
*ノード提供により、利用料が最大70%割引されます。*

---

## 同意UIとプライバシー

訪問者のリソース利用には明示的な同意が必須です。

- **リソース制限**: CPU使用率は最大15%（動画再生相当）。バックグラウンドタブでは自動停止。
- **匿名性**: 処理内容はサイト側に一切開示されません。
- **管理**: 同意状態はlocalStorageに保持（デフォルト30日）。

---

## 対応ワークロード

| workload | 内容 | 実装 |
|----------|------|------|
| `ai-inference` | テキスト分類・要約等 | Transformer.js |
| `image-process` | リサイズ・圧縮等 | OffscreenCanvas |

*将来的にファイル変換等のワークロード追加を予定。*

---

## アーキテクチャ

1. **依頼者** (`@flaxia/sdk`) がタスクを送信。
2. **オーケストレーター** (`@flaxia/worker`) がWebSocket Signalingでノードへタスクを配布。
3. **ノード群** (`@flaxia/node`) がWebRTC DataChannelで処理結果を返却。

タスクは冗長配布され、タイムアウト時は自動再キューイングされます。

---

## 開発

### ローカル起動

```bash
git clone https://github.com/flaxia/flaxia-crowd
cd flaxia-crowd
npm install
npm run dev:worker
```

---

## ライセンス

MIT
---
