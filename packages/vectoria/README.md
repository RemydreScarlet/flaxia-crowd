# Vectoria

**ベクトル検索エンジン** — Flaxia Crowd を基盤とした完全分散型 P2P 検索エンジン。

---

## ビジョン

Google のようなシンプルな UI の裏で、ユーザーブラウザのリソースを活用した分散ベクトル検索を実現します。サーバー不要、従量課金なし、Flaxia Crowd の月額定額モデルに乗った検索体験を提供します。

## アーキテクチャ概要

```
ユーザーブラウザ (Flaxia Crowd Node)
  ├── web-crawl  →  HTML fetch → テキスト抽出
  ├── vector-embed →  Qwen3-0.6B (Transformers.js) → 1024d ベクトル
  ├── vector-store →  IndexedDB + HNSW グラフに保存
  └── vector-query →  ローカル HNSW 検索 → top-k 返送
         ↕ WebSocket
  Cloudflare Workers (Orchestrator)
    ├── NodeManager    — ノード接続・能力管理
    ├── TaskQueue      — タスクライフサイクル
    └── VectorIndex    — シャードマップ管理
         ↕ callback
  Next.js (Cloudflare Pages)
    └── Google 風検索 UI
```

## ドキュメント

詳細は `docs/` ディレクトリを参照してください。

| ドキュメント | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 全体システム構成図、コンポーネント間連携 |
| [docs/search-engine.md](docs/search-engine.md) | 分散ベクトル検索設計、HNSW パラメータ |
| [docs/crowd-crawler-plan.md](docs/crowd-crawler-plan.md) | web-crawl workload 詳細設計 |
| [docs/embedding-pipeline.md](docs/embedding-pipeline.md) | Qwen3-0.6B Embedding、チャンキング戦略 |
| [docs/vector-store-protocol.md](docs/vector-store-protocol.md) | IndexedDB スキーマ、HNSW、VectorIndex DO プロトコル |
| [docs/query-protocol.md](docs/query-protocol.md) | 検索クエリフロー、ファンアウト・マージ戦略 |
| [docs/ui-spec.md](docs/ui-spec.md) | Google 風 UI デザイン仕様 |
| [docs/api-reference.md](docs/api-reference.md) | API エンドポイント定義 |
| [docs/deployment.md](docs/deployment.md) | デプロイ手順 |

## ライセンス

MIT
