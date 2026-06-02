# Phase 0: テストモデル調査

## ステータス: 完了

テストモデルとして `kshitijthakkar/deepseek-v4-mini-3B-init` を特定。

### モデル概要
- アーキテクチャ: DeepSeek-V4 の忠実なスケールダウンレプリカ（ランダム初期化）
- 総パラメータ: ~3.2B / 活性化: ~1.10B
- フォーマット: PyTorch (safetensors)
- hidden_size: 1536, 層数: 28, Routed Experts: 24, Top-4, Shared Expert: 1
- 格納 dtype: bfloat16
- ライセンス: MIT

### 確認事項
- ✅ V4-Flashと同一アーキテクチャ（小規模版）→ Phase 1-A の開発に最適
- ❌ ONNXモデルではない → 分割はPyTorchレベルで行い、個別ONNXエクスポート
- ✅ ランダム初期化だが構造検証には十分
- ✅ V4固有機能 (mHC, CSA/HCA, MTP) を含む

### Phase 0 → Phase 1-A への影響
- ONNXサブグラフ分割を断念し、PyTorchファイル分割 + 個別ONNXエクスポートに方針転換
- このモデルでパイプライン全体を開発・検証する
