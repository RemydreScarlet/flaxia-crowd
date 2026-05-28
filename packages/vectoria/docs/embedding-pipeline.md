# ベクトル埋め込みパイプライン

## 概要

Qwen3-Embedding-0.6B を Transformers.js (ONNX Runtime Web) 経由で Flaxia Crowd ノードのブラウザ上で実行し、テキストから 1024 次元の埋め込みベクトルを生成します。

## 埋め込みモデル

| 項目 | 値 |
|---|---|
| モデル | Qwen3-Embedding-0.6B |
| ONNX パッケージ | `onnx-community/Qwen3-Embedding-0.6B-ONNX` |
| 量子化 | INT8 (`Svenni551/Qwen3-Embedding-0.6B-ONNX-INT8`) |
| 出力次元数 | 1024 |
| 距離関数 | cosine |
| 最大トークン数 | 8192 |
| 対応言語 | 多言語 (英語・中国語・日本語・ドイツ語など) |

## アーキテクチャ

```
Text → [Chunker] → chunks (512token) → [Qwen3-0.6B] → vectors (1024d)
```

処理は Flaxia Crowd の `vector-embed` workload として実装し、各ブラウザノード上で Transformers.js を使用します。

## vector-embed workload 実装

`packages/node/src/workloads/vector-embed.ts`:

```typescript
import { pipeline } from '@huggingface/transformers'

let embeddingPipeline: any = null

export async function handleVectorEmbed(
  payload: VectorEmbedPayload,
): Promise<VectorEmbedResult> {
  const startTime = performance.now()

  // パイプラインの遅延ロード (初回のみ、以降はキャッシュ)
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'onnx-community/Qwen3-Embedding-0.6B-ONNX',
      {
        quantized: true,       // INT8 量子化モデルを使用
        device: 'wasm',        // WebGPU 非対応環境では wasm
      },
    )
  }

  // 推論実行
  const result = await embeddingPipeline(payload.text, {
    pooling: 'mean',
    normalize: true,
  })

  const vector = Array.from(result.data) as number[]
  const duration = performance.now() - startTime

  return {
    vector,
    model: 'Qwen/Qwen3-Embedding-0.6B',
    dimensions: 1024,
    durationMs: Math.round(duration),
  }
}
```

## チャンキング戦略

長文ドキュメントは 512 token 単位でチャンク分割します：

```typescript
function chunkText(text: string, maxTokens = 512): string[] {
  // 簡易的なトークン分割 (正確な tokenizer は Transformers.js を使用)
  // ここでは sentence と paragraph の境界で分割
  const paragraphs = text.split(/\n\n+/)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    const estimatedTokens = para.length / 2  // 日本語は~1.5文字/token
    if ((current.length + para.length) / 2 > maxTokens) {
      chunks.push(current.trim())
      current = para
    } else {
      current += (current ? '\n\n' : '') + para
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}
```

各チャンクは個別の `vector-embed` タスクとして submit され、同一 `docId` + `chunkIndex` で紐付けられます。

## ベクトル保存形式

```
doc-id = crc32(original_url) + ":" + chunkIndex
例: "a1b2c3d4:0", "a1b2c3d4:1", ...
```

## パフォーマンス指標 (ブラウザ上)

| 環境 | 1推論あたり | 備考 |
|---|---|---|
| WASM (CPU, INT8) | 200-500ms | デスクトップ Chrome |
| WebGPU (INT8) | 50-150ms | 対応ブラウザのみ |
| モバイル (WASM) | 500-2000ms | 機種依存 |

Flaxia Crowd のノード選択は CPU load が低いノードを優先するため、`vector-embed` は余裕のあるノードに自然に割り当てられます。

## Transformers.js の注意点

| 注意点 | 対応 |
|---|---|
| 初回読み込みが重い (~10MB モデルDL) | IndexedDB キャッシュ (Transformers.js 自動) |
| WebWorker 内で実行 | メインスレッドをブロックしない |
| WebGPU 対応は限定的 | WASM フォールバックで問題なし |
| INT8 量子化で精度低下 | 実用上問題ないレベル |
