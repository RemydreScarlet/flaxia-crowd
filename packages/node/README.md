# @flaxia/node

一般ウェブサイトに1行で埋め込める**ブラウザノードSDK**。
訪問者のブラウザを Flaxia Crowd の計算ノードとして稼働させます。

## インストール

```bash
npm install @flaxia/node
```

## 使い方

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
})
```

## 設定

### NodeConfig

| プロパティ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `orchestratorUrl` | `string` | yes | オーケストレーターのURL |
| `siteId` | `string` | yes | サイト固有の識別子 |
| `consent` | `ConsentConfig` | yes | 同意UIの設定 |
| `consent.brandName` | `string` | yes | サイト名（同意UIに表示） |
| `consent.position` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | yes | 同意UIの表示位置 |
| `consent.accentColor` | `string` | no | 同意UIのアクセントカラー |
| `maxCpuLoad` | `number` | no | CPU負荷制限（未実装） |

## アーキテクチャ

```
ブラウザタブ
┌────────────────────────────────────────────┐
│ メインスレッド                              │
│  ┌──────────┐  ┌──────────────┐           │
│  │ ConsentUI│  │ Signaling    │           │
│  │ (Shadow  │  │ Client       │──WebSocket─┼──→ Worker
│  │  DOM)    │  │ (WS + WebRTC)│           │
│  └──────────┘  └──────┬───────┘           │
│                       │                    │
│                 ┌─────▼──────┐            │
│                 │ WorkerPool │            │
│                 │ (管理/監視) │            │
│                 └─────┬──────┘            │
├───────────────────────┼────────────────────┤
│ WebWorker             │                    │
│  ┌────────────────────▼──────────────┐    │
│  │ main.worker.ts (ディスパッチャ)    │    │
│  │  ┌──────────┐ ┌──────────┐       │    │
│  │  │ AI推論   │ │ 画像処理 │       │    │
│  │  │ (ONNX)   │ │(Offscreen│       │    │
│  │  │          │ │ Canvas)  │       │    │
│  │  └──────────┘ └──────────┘       │    │
│  │  ┌──────────┐                    │    │
│  │  │ Container│                    │    │
│  │  │(WASM)    │                    │    │
│  │  └──────────┘                    │    │
│  └──────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

### レイヤー構成

| レイヤー | ディレクトリ | 責務 |
|---------|------------|------|
| **同意** | `src/consent/` | Shadow DOM による同意バナー、localStorage への同意保存 |
| **接続** | `src/client/` | WebSocket signaling、WebRTC ピア接続 |
| **実行** | `src/executor/` | WebWorker のライフサイクル管理、タイムアウト処理、WASM コンテナ実行 |
| **Worker** | `src/worker/` | WebWorker エントリ、workload への動的ディスパッチ |
| **Workload** | `src/workloads/` | AI推論・画像処理・コンテナ実行の実装 |

## 対応ワークロード

| workload | ファイル | 技術 |
|----------|---------|------|
| `ai-inference` | `workloads/ai-inference.ts` | 🤗 Transformers.js (ONNX Runtime) |
| `image-process` | `workloads/image-process.ts` | OffscreenCanvas API |
| `container` | `workloads/container.ts` | container2wasm + WASI |

## フロー

1. `initFlaxiaNode()` が呼ばれると、localStorage の同意状態を確認
2. 未同意の場合、Shadow DOM の同意バナーを表示
3. 同意後、WebSocket でオーケストレーターに接続（`/crowd/signal`）
4. タスクを受信すると WebWorker で実行
5. 結果・中間トークンを WebSocket で返送
6. 切断時は指数バックオフ付き自動再接続（最大30秒）

## 開発

```bash
# ビルド
npm run build

# 開発サーバー
npm run dev

# テスト
npm run test
```
