# 導入ガイド

Flaxia Crowdを使い始めるためのステップ・バイ・ステップガイドです。

## 前提条件
- Node.js v22以上
- npm v10以上
- Cloudflare アカウント（Worker開発用）

## インストール
各パッケージは独立しており、用途に合わせてインストールします。

### 依頼者 (Requester)
```bash
npm install @flaxia/sdk
```

### サイトオーナー (Node Provider)
```bash
npm install @flaxia/node
```

## プロジェクトのアーキテクチャ概要
1. **依頼者**: `@flaxia/sdk` を通じて処理をリクエスト。
2. **オーケストレーター**: `@flaxia/worker` (Cloudflare Workers) がタスクをキューイングし、接続可能なノードをマッチング。
3. **ノード**: `@flaxia/node` がWebWorkerで処理を並列実行し、結果を返却。

詳細は各ガイドを参照してください。
