# @flaxia/sdk

Flaxia Crowd の**タスク依頼者向けSDK**。型定義は全パッケージ（worker・node）の単一の真実の源泉です。

## インストール

```bash
npm install @flaxia/sdk
```

依存関係はゼロ（`fetch` のみ使用）。

## 使い方

```typescript
import { FlaxiaClient } from '@flaxia/sdk'

const client = new FlaxiaClient({
  apiKey: 'fc_live_xxxxxxxxxxxx',
})

const task = await client.submit({
  workload: 'ai-inference',
  payload: {
    task: 'text-classification',
    model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    input: 'This is amazing!',
  },
})

// 結果をポーリング
const result = await client.waitForTask(task.id)
console.log(result)
```

## API

### FlaxiaClient

| メソッド | 引数 | 戻り値 | 説明 |
|---------|------|--------|------|
| `submit()` | `SubmitTaskOptions` | `Promise<TaskRecord>` | タスクを投入し、即座に taskId を返す |
| `getTask()` | `taskId: string` | `Promise<TaskRecord>` | タスクの状態を取得 |
| `waitForTask()` | `taskId, intervalMs?, timeoutMs?` | `Promise<TaskRecord>` | 完了するまでポーリング（デフォルト: 2s間隔, 60sタイムアウト） |

### 対応ワークロード

| 型 | 説明 |
|----|------|
| `ai-inference` | HuggingFace Transformers.js によるAI推論 |
| `image-process` | OffscreenCanvas を用いた画像処理（resize, grayscale, compress, thumbnail） |
| `file-convert` | ファイル変換（Phase 2） |
| `container` | container2wasm を用いたLinuxコンテナ実行 |

### Error クラス

| クラス | HTTP Status | code |
|--------|------------|------|
| `AuthenticationError` | 401 | `AUTH_ERROR` |
| `TaskNotFoundError` | 404 | `TASK_NOT_FOUND` |
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `FlaxiaError` | 可変 | 可変（基本クラス） |

## 型定義

`@flaxia/sdk` は以下の型を提供し、`@flaxia/worker` と `@flaxia/node` が参照します:

- `WorkloadType` —  workload 種別のユニオン型
- `AiInferencePayload / AiInferenceResult` — AI推論のペイロード/結果
- `ImageProcessPayload / ImageProcessResult` — 画像処理のペイロード/結果
- `ContainerPayload / ContainerResult` — コンテナ実行のペイロード/結果
- `FileConvertPayload` — ファイル変換のペイロード
- `TaskPayload` — 全ペイロードのユニオン型
- `TaskRecord` — 完全なタスクオブジェクト（状態・結果・エラー等）
- `NodeConfig` — ノード設定（`@flaxia/node` が使用）
