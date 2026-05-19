# 04. ワークロード別実装

## Phase 1 対応ワークロード

| workload | 実装方式 | 難易度 | 優先度 |
|----------|---------|--------|--------|
| `ai-inference` | Transformer.js | 低 | 最高 |
| `image-process` | OffscreenCanvas | 低 | 高 |
| `file-convert` | WASM (予定) | 高 | Phase 2 |

---

## ai-inference（Transformer.js）

```typescript
// src/workloads/ai-inference.ts

import type { AiInferencePayload, AiInferenceResult } from '../types'

export async function runAiInference(payload: AiInferencePayload): Promise<AiInferenceResult> {
  // Transformer.jsを動的import（同意後のみロード）
  const { pipeline } = await import('@xenova/transformers')

  const pipe = await pipeline(payload.task, payload.model)
  const result = await pipe(payload.input, payload.options ?? {})

  return { output: result }
}

type AiInferencePayload = {
  task: string      // 'text-classification' | 'translation' | 'summarization' | ...
  model: string     // HuggingFaceモデル名 例: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
  input: string | string[]
  options?: Record<string, unknown>
}
```

**注意点:**
- モデルのダウンロードは初回のみ（Transformer.jsがキャッシュする）
- 大きなモデル（>500MB）は受け付けない制限を入れる
- WebGPUが使える場合は自動で使う（Transformer.jsが処理する）

---

## image-process（OffscreenCanvas）

```typescript
// src/workloads/image-process.ts

type ImageProcessPayload = {
  operation: 'resize' | 'grayscale' | 'compress' | 'thumbnail'
  imageData: ArrayBuffer   // 画像バイナリ
  options: {
    width?: number
    height?: number
    quality?: number       // 0.0 - 1.0
    format?: 'jpeg' | 'png' | 'webp'
  }
}
```

WebWorker内では `OffscreenCanvas` + `createImageBitmap` で処理する。
DOMが使えないWorker内でも動作する。

---

## file-convert（Phase 2）

Phase 1では実装しない。

将来的には以下を検討：
- PDF → テキスト抽出（pdf.js WASM）
- 動画トランスコード（FFmpeg WASM）※非常に重いため要検討
- Markdown → HTML

container2wasmについては処理速度・バンドルサイズの問題があるため、
軽量WASMライブラリを個別に採用する方針とする。

---

## ワークロード追加時のルール

新しいワークロードを追加する際は：

1. `src/workloads/` に実装ファイルを追加
2. `src/worker/main.worker.ts` のdispatchに追加
3. `WorkloadType` 型に追加
4. `GEMINI.md` のcapabilities一覧を更新
5. `@flaxia/sdk` の型定義も合わせて更新
