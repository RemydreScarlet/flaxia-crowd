# Phase 1-B: Expert Worker アーキテクチャ

## 目的

単一ブラウザタブ内で Coordinator (メインスレッド) + Expert (Web Worker) の
並列推論フレームワークをTypeScriptで実装する。
マルチノード展開のプロトタイプ基盤とする。

## アーキテクチャ

```
メインスレッド (Coordinator)
┌────────────────────────────────────────────┐
│  MoECoordinatorPipeline                    │
│  ├─ Embedding(h) → h_emb                  │
│  ├─ Layer 0: Attention → Router → expert  │
│  │   indices/weights をExpertPoolに送信   │
│  │   ExpertPool から結果を受信 → 集約    │
│  ├─ Layer 1: ...                           │
│  ├─ ...                                    │
│  └─ OutputHead → logits                    │
└────────────────────┬───────────────────────┘
                     │ postMessage (transfer)
                     ▼
Web Worker (ExpertPool)
┌────────────────────────────────────────────┐
│  ExpertPoolManager (複数Worker管理)         │
│  ├─ Worker 0: Expert FFN 0-1, 5-6         │
│  │   ONNX session (expert_subgraph.onnx)   │
│  ├─ Worker 1: Expert FFN 2-4, 7-8         │
│  │   ONNX session (expert_subgraph.onnx)   │
│  └─ 各Workerからの結果をCollect → return   │
└────────────────────────────────────────────┘
```

## TODOリスト

### 1-B.1 型定義拡張

- [ ] `packages/sdk/src/types.ts` にMoE関連型を追加:

```typescript
// MoE推論ペイロード
export interface MoEInferencePayload {
  modelId: string;            // モデル識別子
  input: string | string[];   // 入力テキスト
  options?: MoEInferenceOptions;
}

export interface MoEInferenceOptions {
  max_new_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  do_sample?: boolean;
  repetition_penalty?: number;
}

// Coordinator ↔ Expert 間メッセージ
export interface MoEExpertRequest {
  type: 'expert_forward';
  requestId: string;
  expertIndices: number[];
  hiddenStates: Float32Array;  // または SharedArrayBuffer
  layerIndex: number;
}

export interface MoEExpertResponse {
  type: 'expert_result';
  requestId: string;
  expertOutputs: Float32Array[];  // 各Expertの出力
  layerIndex: number;
}

// Coordinator ↔ ExpertPool (Worker) メッセージ
export interface MoECoordinatorMessage {
  type: 'load_model' | 'forward' | 'unload';
  payload: unknown;
}

export interface MoEExpertPoolMessage {
  type: 'loaded' | 'result' | 'error';
  payload: unknown;
}
```

- [ ] `WorkloadType` に `'moe-inference'` 追加
- [ ] `TaskPayload` に `MoEInferencePayload` 追加
- [ ] `TaskRecord` に子タスクIDリスト `subTaskIds?: string[]` 追加
- [ ] NodeRecord に `role?: 'coordinator' | 'expert'` 追加

### 1-B.2 MoE Expert Pool (Web Worker)

- [ ] `packages/node/src/workloads/moe-expert-pool.worker.ts` 作成

```typescript
// ExpertPool.worker.ts
// 責務: 複数のExpert ONNXサブグラフをロードし、Coordinatorから
// のリクエストに応じてFFN計算を行う

import { pipeline, env } from '@huggingface/transformers';

interface LoadedExpert {
  expertIdx: number;
  session: any; // ONNX Runtime session
}

class MoEExpertPoolWorker {
  private experts: Map<number, any> = new Map();
  private modelId: string = '';
  private dtype: string = 'q4f16';
  private device: string = 'wasm';

  async loadExperts(modelId: string, expertIndices: number[], options?: any) {
    // ONNX session を Expert ごとに作成
    // または 1 session で全Expertをカバー
  }

  async forward(requestId: string, expertIndices: number[], hiddenStates: Float32Array) {
    // 該当ExpertのFFN計算を実行
    // 結果をメインスレッドに返送
  }
}
```

- [ ] ONNX session の初期化・キャッシュ機構
- [ ] 複数Expertの並列実行制御
- [ ] Transferable オブジェクト (SharedArrayBuffer) 対応
- [ ] エラーハンドリング・タイムアウト

### 1-B.3 MoE Coordinator Pipeline

- [ ] `packages/node/src/workloads/moe-coordinator.ts` 作成:

```typescript
// MoE Coordinator
// 責務: モデル全体の順伝搬を制御
// Attention層 + Router を実行し、Expert計算をPoolに委譲

import { pipeline } from '@huggingface/transformers';

export class MoECoordinatorPipeline {
  private coordinatorModel: any;  // Attention + Router 用 ONNX session
  private expertPool: MoEExpertPool;
  private layerCount: number;
  private numExperts: number;
  private topK: number;

  async initialize(modelId: string, options?: any) {
    // Coordinator ONNXモデルをロード
    // ExpertPool を初期化
  }

  async generate(input: string, options?: MoEInferenceOptions): Promise<string> {
    // 1. Tokenize
    // 2. Embedding
    // 3. For each layer:
    //    a. Self-Attention → hidden
    //    b. Router(hidden) → topK indices + weights
    //    c. ExpertPool.forward(topK indices, hidden)
    //    d. 結果を集約: output = sum(weight[i] * expert_out[i])
    //    e. 次層へ
    // 4. Output Head → logits
    // 5. Sampler → next token
    // 6. Repeat until max_new_tokens or EOS
  }
}
```

- [ ] Attention層の実装（transformers.js pipelineでカバーされる部分と分離）
- [ ] Router出力 (expert_indices, weights) の解釈
- [ ] Expert結果の集約機構 (weighted sum)
- [ ] 生成ループ (Auto-regressive decoding)
- [ ] ストリーミング対応 (TextStreamer + onToken callback)
- [ ] サンプリング設定 (temperature, top-p, top-k)

### 1-B.4 ワークロードハンドラ

- [ ] `packages/node/src/workloads/moe-inference.ts` 作成:

```typescript
import { MoECoordinatorPipeline } from './moe-coordinator';
import type { MoEInferencePayload, MoEInferenceResult } from '@flaxia/sdk';

const coordinatorCache = new Map<string, MoECoordinatorPipeline>();

export async function handleMoEInference(
  payload: MoEInferencePayload,
  onToken?: (token: string) => void
): Promise<MoEInferenceResult> {
  // 1. Coordinatorパイプラインを取得/作成 (キャッシュ)
  // 2. generate() を実行
  // 3. ストリーミング対応
  // 4. 結果を返却
}
```

- [ ] `main.worker.ts` に `'moe-inference'` ケース追加
- [ ] `WorkerPool.ts` にストリーミング転送対応（既存でOKならスキップ）

### 1-B.5 単一ブラウザ統合テスト

- [ ] `packages/node/tests/moe-single-browser.test.ts`:
  - Coordinator + ExpertPool (同一Workerプール内) の結合テスト
  - 入力テキストに対する生成結果の検証
  - ストリーミング動作確認
- [ ] DarkShark の MoE 版デモアプリ:
  - `packages/darkshark-moe/` として作成
  - 既存のQwen3-0.6B → MoEモデルに差し替え
  - UIはほぼ同じ（ブランド名変更可）

### 成果物

- [ ] `packages/node/src/workloads/moe-expert-pool.worker.ts`
- [ ] `packages/node/src/workloads/moe-coordinator.ts`
- [ ] `packages/node/src/workloads/moe-inference.ts`
- [ ] `packages/sdk/src/types.ts` の拡張
- [ ] `packages/node/src/worker/main.worker.ts` の拡張
- [ ] テストコード
- [ ] デモアプリ `packages/darkshark-moe/`
