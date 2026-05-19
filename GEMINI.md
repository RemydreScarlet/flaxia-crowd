# GEMINI.md — flaxia-crowd モノレポ

## このリポジトリの目的

**Flaxia Crowd** および **DarkShark** のコアライブラリ群。
一般ウェブサイトの訪問者ブラウザをノードとして使う分散非同期処理サービスの実装。

Flaxia SNS（flaxia.app）とは**独立した別リポジトリ**。
Flaxia SNSへの組み込みはこのモノレポのパッケージをnpmインストールする形で行う。

## パッケージ構成

```
flaxia-crowd/
├── GEMINI.md                   ← このファイル
├── package.json                 ← workspaces定義
├── tsconfig.base.json           ← 共通TypeScript設定
├── packages/
│   ├── worker/                  @flaxia/worker
│   │   → Cloudflare Workers オーケストレーター
│   │   → タスクキュー・Signaling・ノード管理
│   │
│   ├── node/                    @flaxia/node
│   │   → 一般サイト埋め込み用ブラウザノードSDK
│   │   → 同意UI・WebRTC・処理実行
│   │
│   └── sdk/                     @flaxia/sdk
│       → 依頼者向けSDK
│       → タスク投入・結果取得
```

## 技術スタック共通事項

- 言語: TypeScript strict mode
- ビルド: Vite (library mode)
- パッケージマネージャ: npm workspaces
- ターゲット環境: ES2020

## 開発の進め方

**実装順序は必ずこの順番で行う：**

1. `packages/worker` — オーケストレーターが動かないと他が全部机上の空論
2. `packages/node` — Signalingサーバーが動いてから実装する
3. `packages/sdk` — 1と2が動いて初めて正しいAPIが設計できる

各パッケージの詳細は `packages/*/GEMINI.md` を参照。

## ルートpackage.json

```json
{
  "name": "flaxia-crowd",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "dev:worker": "npm run dev --workspace=packages/worker",
    "dev:node": "npm run dev --workspace=packages/node"
  }
}
```

## tsconfig.base.json

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

## パッケージ間の型共有ルール

`@flaxia/worker` ・ `@flaxia/node` ・ `@flaxia/sdk` が共有する型
（WorkloadType・TaskRecord等）は **`@flaxia/sdk`の`types.ts`を単一の真実の源泉**とする。

workerとnodeは`@flaxia/sdk`をdevDependenciesに追加して型だけ参照する。
型定義を変更した場合は必ず3パッケージ同時に更新すること。

## 実装について
- 必ず完了報告をするときはテストにパスしてなくてはならない
- 常にパスするようにズルをしたテストを作成してはならない。

## Flaxia SNSへの組み込み方法

```bash
# flaxia.app リポジトリ側で
npm install @flaxia/worker @flaxia/sdk

# wrangler.tomlへの追記は packages/worker/docs/06-wrangler.md を参照
```
