# 05. エラーハンドリング

## エラークラス階層

```
Error
└── FlaxiaError               基底クラス（すべてのFlaxiaエラー）
    ├── FlaxiaCrowdError      オーケストレーターからのエラーレスポンス
    ├── FlaxiaTimeoutError    ポーリングタイムアウト
    ├── FlaxiaValidationError 入力値不正
    └── FlaxiaNetworkError    ネットワークエラー・fetchの失敗
```

## クラス定義

```typescript
class FlaxiaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlaxiaError'
  }
}

class FlaxiaCrowdError extends FlaxiaError {
  constructor(
    message: string,
    /** オーケストレーターが返したエラーコード */
    public readonly code: string,
    /** HTTPステータスコード */
    public readonly statusCode: number
  ) {
    super(message)
    this.name = 'FlaxiaCrowdError'
  }
}

class FlaxiaTimeoutError extends FlaxiaError {
  constructor(public readonly taskId: string) {
    super(`Task ${taskId} did not complete within the specified timeout`)
    this.name = 'FlaxiaTimeoutError'
  }
}

class FlaxiaValidationError extends FlaxiaError {
  constructor(message: string) {
    super(message)
    this.name = 'FlaxiaValidationError'
  }
}

class FlaxiaNetworkError extends FlaxiaError {
  constructor(message: string, public readonly cause: unknown) {
    super(message)
    this.name = 'FlaxiaNetworkError'
  }
}
```

## エラーコード一覧（FlaxiaCrowdErrorのcode）

| code | statusCode | 意味 |
|------|-----------|------|
| `UNAUTHORIZED` | 401 | APIキーが無効 |
| `TASK_NOT_FOUND` | 404 | タスクIDが存在しない |
| `TASK_FAILED` | 500 | タスクがリトライ上限に達して失敗 |
| `QUEUE_FULL` | 503 | キューが満杯（しばらく待って再試行） |
| `INVALID_PAYLOAD` | 400 | ペイロードが不正 |
| `MODEL_TOO_LARGE` | 400 | モデルサイズ上限超過 |
| `UNSUPPORTED_WORKLOAD` | 400 | 対応していないworkload |

## 使い方（ユーザー向けドキュメント想定）

```typescript
import { FlaxiaClient, FlaxiaCrowdError, FlaxiaTimeoutError } from '@flaxia/sdk'

try {
  const result = await client.submit({ ... })
} catch (err) {
  if (err instanceof FlaxiaTimeoutError) {
    console.log('処理が時間内に完了しませんでした。タスクID:', err.taskId)
    // あとでclient.getTask(err.taskId)で確認できる
  } else if (err instanceof FlaxiaCrowdError) {
    if (err.code === 'QUEUE_FULL') {
      console.log('混雑しています。しばらく後に再試行してください')
    } else {
      console.log('エラー:', err.message, err.code)
    }
  } else {
    throw err  // 予期しないエラーは再throw
  }
}
```

## FlaxiaTimeoutError後の結果確認

タイムアウトしてもタスク自体はWorker上で処理継続中の場合がある。
`taskId` を保存しておけば後から結果を取得できる：

```typescript
// タイムアウト後、数分後に確認
const result = await client.getTask(savedTaskId)
if (result.status === 'done') {
  // 完了していた
}
```
