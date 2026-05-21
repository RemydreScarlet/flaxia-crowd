# GEMINI.md — @flaxia/node

## このパッケージの目的

一般ウェブサイトに1行で埋め込める**ブラウザノードSDK**。
訪問者のブラウザを Flaxia Crowd の処理ノードにする。

## 技術スタック

- ビルド: Vite (library mode)
- 出力: ESM + UMD（CDN配信考慮）
- ターゲット: ES2020
- バンドルサイズ目標: gzip後200KB以下（Transformer.jsは動的import）

## 実装すべき機能

1. `docs/01-consent-ui.md` — Shadow DOM同意UI
2. `docs/02-node-client.md` — Signaling接続管理
3. `docs/03-worker-executor.md` — WebWorker処理実行
4. `docs/04-workloads.md` — ワークロード別実装
5. `docs/05-cpu-throttle.md` — CPU負荷制限

## ディレクトリ構成

```
packages/node/
├── GEMINI.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/
│   ├── 01-consent-ui.md
│   ├── 02-node-client.md
│   ├── 03-worker-executor.md
│   ├── 04-workloads.md
│   └── 05-cpu-throttle.md
└── src/
    ├── index.ts
    ├── consent/
    │   ├── ConsentUI.ts
    │   └── storage.ts
    ├── client/
    │   ├── SignalingClient.ts
    │   └── WebRTCPeer.ts
    ├── executor/
    │   ├── WorkerPool.ts
    │   └── throttle.ts
    └── workloads/
        ├── ai-inference.ts
        ├── image-process.ts
        └── file-convert.ts   # Phase 2
```

## package.json

```json
{
  "name": "@flaxia/node",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "main": "./dist/index.umd.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@flaxia/sdk": "*",
    "@xenova/transformers": "^2.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

## 公開API

```typescript
import { initFlaxiaNode } from '@flaxia/node'

initFlaxiaNode({
  orchestratorUrl: 'https://crowd.flaxia.app',
  siteId: 'your-site-id',
  consent: {
    brandName: 'あなたのサービス名',
    position: 'bottom-right',
    accentColor: '#6366f1',
  },
  maxCpuLoad: 0.15,
})
```

## コーディング規約

- DOM操作はすべてShadow DOM内（サイトCSSと干渉させない）
- WebWorkerコードは `src/worker/` 以下に分離
- Transformer.jsは動的importで遅延ロード（同意後のみ）
- グローバル汚染禁止（`window`への代入禁止）
