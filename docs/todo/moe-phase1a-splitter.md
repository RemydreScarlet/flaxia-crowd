# Phase 1-A: ONNX Model Splitter

## 目的

ONNX形式のMoEモデルを解析し、Coordinator用・Expert Worker用の
サブグラフに分割するPythonスクリプトを作成する。

## アーキテクチャ

```
入力: model.onnx (MoEモデル全体)
  │
  ▼
analyze-onnx-moe.py (Phase 0.3)
  │  モデル構造JSONを出力
  ▼
split-onnx-moe.py
  │
  ├── coordinator.onnx  (Embedding + Attention + Router + OutputHead)
  │     └─ Routerが出力する expert_indices tensor を graph output に追加
  │
  └── experts/
        ├── expert_000.onnx  (Expert #0 FFN サブグラフ)
        ├── expert_001.onnx  (Expert #1 FFN サブグラフ)
        └── ...

出力: Coordinator用モデル + N個のExpert用モデル
```

## TODOリスト

### 1-A.1 環境セットアップ

- [ ] Python ONNX依存関係の追加
  ```
  # requirements-dev.txt に追加:
  onnx>=1.16.0
  onnxruntime>=1.18.0
  onnxscript  # MoE opset 解析用
  numpy
  ```
- [ ] `scripts/` ディレクトリの作成
  ```
  scripts/
  ├── split-onnx-moe.py           # メイン分割スクリプト
  └── lib/
      ├── onnx_graph_utils.py     # ONNXグラフユーティリティ
      ├── moe_op_detector.py      # MoE ops 検出
      └── subgraph_extractor.py   # サブグラフ抽出
  ```

### 1-A.2 MoEオペレーター解析

- [ ] `com.microsoft.QMoE` / `com.microsoft.MoE` オペレーターの入出力を調査
  - 入力: hidden_states, router_weights (オプション), expert_weights (内蔵)
  - 出力: expert_outputs, router_logits (オプション)
- [ ] 各MoEオペレーターから以下を抽出する手段を実装:
  - Expert数 (`num_experts`)
  - Top-k (`k`)
  - 活性化関数タイプ (SwiGLU, ReLU, GELU)
  - 各Expertの重みテンソルを取得可能か

### 1-A.3 サブグラフ抽出ロジック

- [ ] Coordinatorサブグラフ抽出:
  - Attention, LayerNorm, Embedding, Router のノードを残す
  - MoEオペレーターを Router 部分（ゲート値計算）だけ残すか置換
  - 出力に expert_indices + router_weights を追加
- [ ] Expertサブグラフ抽出:
  - 1個のExpert FFNに対応するノードだけを抽出
  - 入力: hidden_states (1D or 2D tensor)
  - 出力: expert_output (same shape as input)
- [ ] 各サブグラフの入出力が整合することをONNX shape inferenceで検証
- [ ] 量子化形式 (QMoE) 対応:
  - 量子化されたExpert重みのデコード方法を確立
  - Q4, Q8 それぞれ対応

### 1-A.4 分割結果の検証

- [ ] Coordinatorモデル単体で推論テスト:
  - Router出力 (expert_indices) が正しいか確認
  - Attention部分の出力が元モデルと一致するか確認
- [ ] Expertモデル単体で推論テスト:
  - 既知の入力に対する出力が元モデルの該当Expert出力と一致するか確認
- [ ] Coordinator + Expert 結合推論テスト:
  - Coordinatorが出したexpert_indicesで該当Expertを呼び出し
  - 重み付き和を計算 → 元モデルの出力と一致することを確認
  - 数値誤差が許容範囲内であることを確認 (atol=1e-3)

### 1-A.5 複数モデル対応

- [ ] Qwen3-30B-A3B 対応（ONNXエクスポート後）
  - `scripts/analysis/moe-model-configs/qwen3-30b-a3b.json`
- [ ] OLMoE-1B-7B 対応
  - `scripts/analysis/moe-model-configs/olmo-1b-7b.json`
- [ ] DeepSeek-V2-Lite 対応
  - `scripts/analysis/moe-model-configs/deepseek-v2-lite.json`

### 成果物

- [ ] `scripts/split-onnx-moe.py` — メイン実行スクリプト
- [ ] `scripts/lib/onnx_graph_utils.py` — ONNXグラフ操作ユーティリティ
- [ ] `scripts/lib/moe_op_detector.py` — MoEオペレーター検出
- [ ] `scripts/lib/subgraph_extractor.py` — サブグラフ抽出
- [ ] 各モデルの分割設定JSON (`moe-model-configs/*.json`)
- [ ] 分割済みモデル出力 (デフォルト: `./output/moe/{model_name}/`)
