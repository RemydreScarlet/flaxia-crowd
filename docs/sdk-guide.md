# 依頼者向けSDKガイド (@flaxia/sdk)

タスクの投入から結果取得までを行うためのクライアントライブラリです。

## クライアント初期化

```typescript
import { FlaxiaClient } from '@flaxia/sdk'

const client = new FlaxiaClient({
  apiKey: process.env.FLAXIA_API_KEY,
  // オプション: APIエンドポイント変更など
})
```

## 同期タスク投入 (submit)
結果が返るまで待機します。

```typescript
const result = await client.submit({
  workload: 'ai-inference',
  payload: {
    task: 'sentiment-analysis',
    text: 'Great product!',
  },
  waitTimeoutMs: 30000, // 30秒
})
```

## 非同期タスク投入 (submitAsync)
結果をWebhookで受け取ります。

```typescript
await client.submitAsync({
  workload: 'image-process',
  payload: { /*...*/ },
  callbackUrl: 'https://api.your-service.com/webhook/flaxia',
})
```

## エラーハンドリング
- `FlaxiaTimeoutError`: タイムアウトが発生した場合
- `FlaxiaValidationError`: パラメータが不正な場合
