# 分散ベクトル検索エンジン設計

## 概要

伝統的な Elasticsearch のような集中型ベクトルDBを使わず、Flaxia Crowd ノード群の IndexedDB 上に分散 HNSW グラフを構築して検索します。

## シャーディング戦略

### シャードキー生成

各ドキュメントのシャード归属は document ID のハッシュで決定します：

```
shardKey = CRC32(docId) % 65536   // 0x0000 - 0xFFFF
```

### シャード割り当て

VectorIndex Durable Object が管理します：

| プロパティ | 値 |
|---|---|
| シャード総数 | 65536 (2^16) |
| 1ノードあたりの担当シャード数 | 動的 (ノード数に応じて自動計算) |
| デフォルト範囲サイズ | 65536 / N  (N = storage node 数) |
| レプリケーション係数 M | 3 |

### ノード参加時フロー

```
1. Node が WebSocket 接続 (capabilities に vector-store を含む)
2. NodeManager が VectorIndex DO に通知
3. VectorIndex DO:
   a. 生存ノードリスト更新
   b. シャード範囲を再計算し全ノードに再割り当て
   c. 各ノードに WebSocket 経由で「あなたの担当範囲」を通知
4. Node が IndexedDB を初期化 (または既存データを確認)
```

### ノード離脱時

VectorIndex DO の `webSocketClose` ハンドラが検出：

- 離脱ノードが担当していたシャード範囲を別の生存ノードに再割り当て
- 該当シャードのベクトルは喪失（レプリケーション M=3 で完全喪失を回避）
- 喪失したベクトルは次回クロール時に別ノードが再インデックス

## HNSW パラメータ

| パラメータ | 値 | 説明 |
|---|---|---|
| M | 16 | 各レイヤーの最大エッジ数 |
| efConstruction | 200 | グラフ構築時の探索幅 |
| efSearch | 50 | 検索時の探索幅 (精度と速度のトレードオフ) |
| 距離関数 | cosine | Qwen3-Embedding の出力に適合 |
| 最大レイヤー | log2(ベクトル数) | 自動決定 |
| 次元数 | 1024 | Qwen3-Embedding-0.6B の出力次元 |

## スコアリングとマージ戦略

### 各ノード内

HNSW 検索結果は cosine 類似度 `[0, 1]` でスコアリング：

```typescript
interface LocalResult {
  docId: string;
  score: number;       // cosine similarity
  metadata: Record<string, unknown>;
}
```

### Orchestrator でのマージ

```typescript
function mergeResults(nodesResults: LocalResult[][]): LocalResult[] {
  const merged = new Map<string, LocalResult & { sources: number }>()

  for (const results of nodesResults) {
    for (const r of results) {
      const existing = merged.get(r.docId)
      if (!existing || r.score > existing.score) {
        merged.set(r.docId, { ...r, sources: 1 })
      } else if (existing) {
        existing.sources++
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}
```

### Score 重み付け (オプション)

長期的にはノード信頼度に基づく重み付けを検討：

```typescript
const weight = node.metrics.successRate * (1 - node.metrics.cpuLoad)
const weightedScore = result.score * weight
```

## インデックス戦略

### バッチインデックス

大量クロール時は orchestrator がバッチ処理：

1. クロール完了 → text 取得
2. text を 512token 単位でチャンク分割
3. 各チャンクを別々の vector-embed タスクとして submit
4. 各 embedding 完了 → vector-store タスクを submit
5. VectorIndex DO が書き込み先ノードを決定

### 増分インデックス

単一 URL の再クロール時：

1. 既存の docId (`crc32(url)`) を削除する vector-delete タスク (存在する場合)
2. 新規クロール → embedding → store
3. VectorIndex DO のシャード統計を更新

## 制限事項

| 項目 | 制限値 | 備考 |
|---|---|---|
| IndexedDB 容量 | ブラウザ依存 (通常 ~1GB/オリジン) | 1ノードあたり |
| 1ノードあたり最大ベクトル数 | ~50万 (1024d, cosine, M=16) | メモリ/ストレージ制限 |
| 検索レイテンシ | 数百ms〜数秒 | ファンアウト・ネットワーク依存 |
| データ永続性 | ベストエフォート | ノード離脱で消失、再クロール前提 |
