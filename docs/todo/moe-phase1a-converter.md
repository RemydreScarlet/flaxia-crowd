# Phase 1-A: PyTorch → ファイル分割 → ONNX 変換

## 目的

PyTorch MoEモデル (DeepSeek-V4-Flash等) のチェックポイントを解析し、
Coordinator用・Expert Worker用の個別ファイル＋ONNXに変換する。

## 背景

従来のONNXグラフ操作による分割（QMoE op解析＋サブグラフ抽出）ではなく、
**PyTorchレベルで重みを分割してから個別にONNXエクスポート**する方式に方針転換。

理由:
- QMoEカスタムopの内部構造解析が不要
- PyTorch → ONNX export で正しさを検証可能（元モデル出力との比較）
- int8/int4量子化を export 前に行える

## アーキテクチャ

```
入力: model.safetensors or .bin (PyTorch)
  │   config.json
  ▼
convert-moe-model.py
  │
  ├── coordinator/
  │   ├── model.safetensors  (Embed + Attention + mHC + Router + SharedExpert + OutputHead)
  │   └── model.onnx
  │
  ├── experts/
  │   ├── expert_000/
  │   │   ├── model.safetensors  (Gate.weight + Up.weight + Down.weight)
  │   │   └── model.onnx
  │   ├── expert_001/
  │   └── ...
  │
  └── model_info.json  (モデル構造・Expert配置情報)
```

## 変換フロー詳細

### Step 1: モデル構造解析
モデル設定情報を読み取り、MoE構造を把握:

- hidden_size, num_layers, num_experts, top_k
- 活性化関数タイプ (clamped SwiGLU)
- Routerパラメータ (ルーティング重み・bias)
- Shared Expert の有無・パラメータ
- Hash-routed layer の有無
- MTP head の有無
- 量子化情報 (bf16/int8/int4)

### Step 2: 重みの分類
チェックポイントの全テンソルを以下に分類:

| カテゴリ | 例 | 出力先 |
|----------|----|--------|
| Embedding | `model.embed_tokens.weight` | Coordinator |
| Attention | `model.layers.*.self_attn.*` | Coordinator |
| mHC | `model.layers.*.hc_*` | Coordinator |
| Router | `model.layers.*.mlp.gate.*` (routing weights) | Coordinator |
| Shared Expert | `model.layers.*.mlp.shared_experts.*` | Coordinator |
| Routed Expert | `model.layers.*.mlp.experts.*` (gate/up/down) | Expert N |
| Output Head | `model.lm_head.weight`, `model.lm_head.e_proj`, `h_proj` | Coordinator |
| MTP Head | `model.mtp_head.*` | Coordinator or separate |

### Step 3: Coordinatorモデル構築
- 全非Expert重みを統合
- Routerは重みのみ保持（ゲート計算はPython/TSで行う）
- Shared Expert FFNもCoordinator側で計算
- ONNXエクスポート（標準Transformerとして）

### Step 4: Expertモデル構築
各routed expertごとに:

- Gate.weight, Up.weight, Down.weight を抽出
- SwiGLU FFN (Gate→SwiGLU→Up→Mul→Down) のONNXグラフを組み立て
- 入力: hidden_states (float, [-1, hidden_size])
- 出力: expert_output (float, [-1, hidden_size])
- 個別エクスポート（ONNXファイル）

### Step 5: 検証
分割モデルの出力が元モデルと一致することを確認:

- Coordinator単体: Router出力 (expert_indices + weights) が元モデルと一致
- Expert単体: 既知の入力に対する出力が元モデルの該当Expert出力と一致
- 結合: CoordinatorのRouter結果でExpertを呼び出し、重み付き和が元モデルと一致
- Shared Expert: Coordinator側の出力が正しいことを確認

## TODOリスト

### 1-A.1 環境セットアップ
- [ ] Python依存関係の追加 (torch, transformers, onnx, onnxruntime)
- [ ] `scripts/convert-moe-model.py` ディレクトリ構成
  ```
  scripts/
  ├── convert-moe-model.py      # メイン変換スクリプト
  ├── lib/
  │   ├── model_loader.py       # PyTorchモデルロード・構造解析
  │   ├── weight_splitter.py    # 重みの分類・分割
  │   ├── coordinator_builder.py # Coordinatorモデル構築・ONNX export
  │   └── expert_builder.py     # Expertモデル構築・ONNX export
  ```

### 1-A.2 テストモデル準備
- [ ] `kshitijthakkar/deepseek-v4-mini-3B-init` のダウンロードと動作確認
- [ ] モデル構造の解析・ドキュメント化
- [ ] 変換設定JSON (`moe-model-configs/deepseek-v4-mini-3B.json`)
- [ ] DeepSeek-V4-Flash用変換設定 (`moe-model-configs/deepseek-v4-flash.json`)

### 1-A.3 重み分割ロジック
- [ ] チェックポイントからのテンソル名抽出・分類
- [ ] Coordinator重みの抽出・保存 (safetensors)
- [ ] Expert重みの抽出・保存 (safetensors)
- [ ] Shared Expert重みの抽出（Coordinatorに統合）
- [ ] Hash-routed layerの特別処理 (最初の2層)
- [ ] MTP headの処理方法決定

### 1-A.4 ONNX エクスポート
- [ ] CoordinatorモデルのONNXエクスポート
  - Embedding + Attention + mHC + Router(重みのみ) + Shared Expert + OutputHead
  - ONNX opset選択 (opset 21+)
- [ ] ExpertモデルのONNXエクスポート
  - SwiGLU FFN (MatMul + SiLU + Mul + MatMul)
  - 動的バッチサイズ対応
  - int8/int4量子化対応
- [ ] ONNX shape inference による入出力整合性検証

### 1-A.5 分割結果の検証
- [ ] Coordinator単体推論テスト:
  - Router出力 (expert_indices, weights) が元モデルと一致
  - Attention出力の一致確認
  - Shared Expert出力の一致確認
- [ ] Expert単体推論テスト:
  - 既知のhidden_states入力 → 出力が元モデルの該当Expertと一致
- [ ] Coordinator + Expert 結合推論テスト:
  - 全層の出力が元モデルと一致 (atol=1e-3)

### 1-A.6 CLIツール
- [ ] `--model-id` / `--checkpoint-path` 指定
- [ ] `--output-dir` 指定
- [ ] `--dtype` (bf16/fp16/fp32) 指定
- [ ] `--quantize` (int8/int4) 対応
- [ ] `--analyze-only` モード（分割せず構造のみ表示）
- [ ] `--skip-experts` モード（Coordinatorのみ出力）
- [ ] `--verify` モード（分割後モデルの推論一致検証）

### 成果物
- [ ] `scripts/convert-moe-model.py`
- [ ] `scripts/lib/model_loader.py`
- [ ] `scripts/lib/weight_splitter.py`
- [ ] `scripts/lib/coordinator_builder.py`
- [ ] `scripts/lib/expert_builder.py`
- [ ] `scripts/moe-model-configs/` (V4-mini, V4-Flash設定)
- [ ] 変換済みモデル出力 (Coordinator + N x Expert)
