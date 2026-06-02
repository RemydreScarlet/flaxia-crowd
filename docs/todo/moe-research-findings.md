# MoE 分散推論 文献調査・技術調査 報告書

調査日: 2026-06-02

## 1. 分散MoE推論システム 先行研究

### 1.1 Petals (2022-2023, NeurIPS 2023)
**論文**: https://arxiv.org/abs/2209.01188
**コード**: https://github.com/bigscience-workshop/petals

- **方式**: P2P パイプラインモデル並列
- **モデル**: BLOOM-176B, Llama 2 70B, Mixtral 8x22B など
- **性能**: コンシューマGPUでBLOOM-176Bが~1 step/sec。ローカルオフロードより10x高速
- **アーキテクチャ**:
  - 各サーバーが一部のTransformer層を保持 (パイプライン並列)
  - クライアントがサーバーのチェーンを形成して推論
  - DHT (分散ハッシュテーブル) でサーバー検出
- **耐障害性**: Dual attention cache + サーバー障害時の急速再割当
- **負荷分散**: 疎結合・非集中型の負荷分散アルゴリズム
- **flaxia-crowdへの示唆**: MoEにおけるパイプライン並列の基本設計として参考になる。ただしflaxiaはブラウザベースでPetalsはPython/PyTorchベース。

### 1.2 Prism (arXiv 2508.12851, Apr 2026)
**論文**: https://arxiv.org/abs/2508.12851

- **方式**: エッジサーバー間協調MoE推論
- **ターゲット**: メモリ制約のあるエッジGPUサーバー (RTX 4090/A4000クラス)
- **最適化対象**: 異種混在エッジ環境での推論レイテンシ
- **主要技術**:
  1. **Activation-Aware Expert Placement**: エキスパート活性化パターンのエントロピーに基づく配置。シャノンエントロピーを使って層ごとに必要なExpert数を計算
  2. **Layer-wise Expert Count Allocation**: 活性化パターンの多様性に応じて層ごとのエキスパート割当数を決定
  3. **Expert-to-Server Assignment**: アクティベーション頻度に基づく貪欲割当 (1-1/e近似保証)
  4. **軽量Expert Migration**: 5分間隔で再評価、マイグレーションコストと通信コストを比較して判断
- **性能**: レイテンシ最大30.6%削減 (DeepSeek-V2-Lite), EPLB比
- **Prismの知見** (flaxiaに直接適用可能):
  - エキスパート活性化パターンは**タスクに強く依存**し、**安定している** → 短期間の予測が可能
  - 層ごとに活性化パターンが異なる → 層ごとの割当最適化が有効
  - **ローカル実行比率が高いほどレイテンシが低い** → バースト的なリモート呼び出しを避ける設計が重要
  - 帯域幅の影響: 100 Mbps→1000 Mbpsで55%性能改善 (4GPU時)
- **flaxia独自の課題**: PrismはエッジGPUサーバー (NVMe接続) が前提。flaxiaはブラウザ (WASM/WebGPU) のため、計算速度・メモリともに桁違いに制約がある。

### 1.3 Speculative MoE (ICML 2025)
**論文**: https://arxiv.org/abs/2503.04398

- **方式**: EP (Expert Parallelism) のall-to-all通信削減
- **主要技術**:
  1. **Speculative Token Shuffling**: 将来トークンのルーティングパスを予測し、事前にトークンを適切なデバイスに再配置
  2. **Speculative Expert Grouping**: 将来必要になるエキスパートを事前にグループ化
- **効果**: all-to-all通信量を削減。高速・低速両方のインターコネクトで有効
- **flaxiaへの示唆**: ブラウザ環境ではall-to-allが特に遅い (WebRTC/WS経由)。Speculativeな予測転送が有効。

### 1.4 Semantic Parallelism / Sem-MoE (ICLR 2026)
**論文**: https://openreview.net/forum?id=MSHPrMpIHZ

- **方式**: モデル-データ協調スケジューリング
- **主要技術**:
  1. **Offline Model Scheduling**: 同時活性化されやすいExpert同士をクラスタリングし同一デバイスに配置
  2. **Online Inter-request Data Scheduling**: リクエストをホストしているExpertに最も関連するデバイスに振り分け
  3. **Online Intra-request Data Scheduling**: トークンを動的再シャッフルしてリモートルーティングを削減
- **flaxiaへの示唆**: 協調活性化パターンに基づくExpert配置はブラウザ環境でも有効。

### 1.5 MoBiLE (ASP-DAC 2026)
**論文**: https://www.aspdac.com/aspdac2026/archive/pdf/6F-5.pdf

- **方式**: コンシューマGPU用オフローディング + Big-Little Expert
- **主要技術**:
  - 重要でないトークンには半分のExpertのみ使用
  - 重要なトークンには全Expertを使用
  - 専用のfallback/prefetch機構
- **効果**: 1.60-1.72x 高速化
- **flaxiaへの示唆**: トークンの重要度に応じて活性化Expert数を動的に変える手法は、通信帯域幅が限られるブラウザ環境に特に有効。

### 1.6 VELA (ICDCS 2025)
**論文**: https://iqua.ece.toronto.edu/papers/chenghao-icdcs25.pdf

- **方式**: MoEファインチューニングの通信最適化
- **発見**: Expert層へのアクセスは**均一ではなく、安定した局所性 (locality) を持つ**
- **効果**: 通信オーバーヘッド最大25%削減

### 1.7 MoE-Infinity + Lynx (2024-2025)
- **MoE-Infinity**: 単一デバイスで動的Expertロード/アンロード。頻繁に使うExpertをGPUにキャッシュ
- **Lynx**: バッチレベルでの動的Expertリマッピング。ワークロード非依存

## 2. MoEモデル最新動向 (2026年春時点)

### 2.1 Qwen3 シリーズ (Alibaba, May 2025)
**論文**: https://arxiv.org/abs/2505.09388

| モデル | Total | Active | Experts | Top-K | Layers | Hidden | 備考 |
|--------|-------|--------|---------|-------|--------|--------|------|
| Qwen3-30B-A3B | 30.5B | 3.3B | 128 | 8 | 48 | 2048 | **ターゲット** |
| Qwen3-235B-A22B | 235B | 22B | 256 | 8 | 64 | 4096 | 大規模版 |
| Qwen3.6-35B-A3B | 35B | 3B | - | - | - | - | VL-MoE (Vision) |

**Qwen3-30B-A3B 詳細パラメータ** (HuggingFace Qwen3MoeConfig):
- vocab_size: 151936
- hidden_size: 2048
- intermediate_size: 6144
- num_hidden_layers: 48
- num_attention_heads: 16
- num_key_value_heads: 4 (GQA)
- num_experts: 128
- num_top_k: 8
- MoE層: 全48層 (dense FFN無し)
- 対応コンテキスト長: 32K (YaRNで131K)
- 思考モード/非思考モード切替対応

### 2.2 ブラウザ互換MoEモデル

| モデル | Total | Active | ONNX変換 | ブラウザ推論 |
|--------|-------|--------|----------|-------------|
| OLMoE-1B-7B | 7.2B | 1.3B | ✅ via Optimum | ✅ 余裕 (Q4: ~400MB) |
| LFM2-8B-A1B | ~8B | ~1B | ✅ via Optimum | ✅ 最軽量 (Q4: ~500MB) |
| Qwen3-30B-A3B | 30.5B | 3.3B | ⚠️ Optimum対応確認中 | Coordinator部のみ: ✅ ~700MB |
| DeepSeek-V2-Lite | 15.7B | 2.4B | ⚠️ ONNXモデル有無確認中 | 同上 |

Transformers.js v4 (2026年リリース) は Qwen3.5 と LFM2.5-1.2B の WebGPU 推論デモで動作確認済み。

### 2.3 業界動向
- 2026年現在、事実上すべてのフロンティアオープンモデルがMoEを採用 (DeepSeek V3.2, Llama 4, Kimi K2.5, GLM-5, MiniMax-M2, GPT-OSS)
- HuggingFace Transformers v5 (2026): Expert Parallelism (`enable_expert_parallel`) をネイティブサポート
- WeightConverter: チェックポイントのExpertテンソルをランタイムのpacked形式に変換する仕組み (chunk/concatenate/split操作)
- Expert Backend: eager / batched_mm / grouped_mm の3バックエンドをプラガブルに切替可能

## 3. ONNXモデル分割技術

### 3.1 既存ツール・アプローチ

**ONNX Python API によるモデル手術**:
- `onnx.load()` → グラフ走査 → `onnx.helper.make_graph()` でサブグラフ抽出
- 入出力テンソル名を指定して部分実行 (`onnxruntime.InferenceSession` の入出力指定)
- 量子化対応: `com.microsoft.QMoE` contrib op の解析が必要

**アプローチ: ONNX Subgraph Extraction**:
```python
import onnx

model = onnx.load("model.onnx")
graph = model.graph

# Step 1: MoE ops を特定
moe_nodes = [n for n in graph.node if n.op_type == "QMoE" or n.op_type == "MoE"]

# Step 2: 各MoE op の入出力を特定
# 入力: hidden_states, router_weights (optional)
# 出力: output, router_logits (optional)

# Step 3: Expert重みテンソルを初期化子から抽出
# Step 4: Coordinator用サブグラフ (MoE op → router部分のみ) を構築
# Step 5: Expert用サブグラフ (1個のExpert FFN) を構築
```

**課題**:
- `com.microsoft.QMoE` は量子化されたExpert重みを内包するカスタムop。内部構造の解析が必要
- モデルによってMoEのop実装が異なる可能性
- 現時点で汎用的なMoE分割ツールは存在しない。独自開発が必要

### 3.2 HuggingFace Transformers v5 の WeightConverter
```python
# Expertテンソルを個別→packed形式に変換
WeightConverter(
    ["block_sparse_moe.experts.*.w1.weight", "block_sparse_moe.experts.*.w3.weight"],
    "mlp.experts.gate_up_proj",
    operations=[
        MergeModulelist(dim=0),  # リスト結合
        Concatenate(dim=1),      # 次元連結
    ],
)

# Packed→個別に分割 (SplitModulelist)
WeightConverter(
    "mlp.experts.down_proj",
    "block_sparse_moe.experts.*.w2.weight",
    operations=[SplitModulelist(dim=0)],
)
```

flaxia用のONNX分割では逆の操作 (packed→個別) が必要。

## 4. ブラウザ間通信技術評価

### 4.1 WebRTC DataChannel

| 特性 | 値 |
|------|-----|
| プロトコル | SCTP over DTLS over UDP |
| レイテンシ (同一LAN) | 1-5ms RTT |
| レイテンシ (インターネット) | 20-200ms RTT |
| スループット (default SCTP) | ~100 Mbps |
| スループット (最適化後) | 数百 Mbps |
| 最大メッセージサイズ | 256KB (Chrome) / 64KB (Firefox→Chrome) |
| 信頼性 | 選択可能 (ordered/unordered, reliable/unreliable) |
| NAT越え | STUN/TURN必要 |
| WebSocket比の速度 | 1.15-2.5x 高速 (小メッセージで有利) |

**重要**: 1 MoE層 あたりの通信サイズ見積もり
- hidden_size=2048, fp16 (2bytes)
- 8 experts × (2048 × 2) = **32KB** (送信: Coordinator→Expert)
- 8 experts × (2048 × 2) = **32KB** (受信: Expert→Coordinator)
- 合計: **64KB / layer**
- 48 layers → **3MB / token**

3MBのデータ転送が各トークンの生成ごとに発生。100Mbpsで約240ms、バッチサイズ4で約60msまで低減可能。

### 4.2 Cloudflare Relay (WebSocket)

| 特性 | 値 |
|------|-----|
| レイテンシ (relay経由) | 10-50ms (Cloudflare edgeからの距離依存) |
| スループット | 制限あり (Cloudflare Workers Free: 10MB/response) |
| NAT越え | 不要 (リレー接続) |
| サーバーコスト | Cloudflare Workers の CPU時間消費 |

**flaxiaへの推奨**: Phase 2 は Cloudflare Relay (WS) を採用。Phase 3 で WebRTC DataChannel に最適化。

### 4.3 データ圧縮の可能性

| 方式 | 圧縮率 | 処理時間 | 適用判断 |
|------|--------|---------|----------|
| 無圧縮 (fp16) | 1x | 0ms | フェーズ1で採用 |
| 量子化転送 (int8) | 2x | ~0.1ms | **フェーズ2で採用推奨** (精度影響小) |
| zstd/lz4圧縮 | 1.1-1.5x | ~1ms | 非効率 (隠れ状態は乱数に近く圧縮効率低い) |
| 差分転送 | 2-4x (推定) | ~0.5ms | フェーズ3で検討 (Attention出力の変化が小さい場合有効) |

## 5. アーキテクチャの再評価: 3つの分散戦略

### 戦略A: エキスパート並列 (元の提案)
各ブラウザノードが一部のExpert FFNを保持。CoordinatorがAttention+Router。
- ✅ MoEのスパース性を最大活用
- ✅ メモリ効率が最良 (各ノードの負荷が軽い)
- ❌ **all-to-all通信が全体のボトルネック** (各層で8回のリモート呼び出し)
- ❌ 同期的な通信 (全Expertの結果を待ってから次層へ)

### 戦略B: パイプライン並列 (Petals方式)
層単位で分割。各ノードが連続する数層を担当。
- ✅ 通信回数が少ない (層境界のみ)
- ✅ パイプライン化でスループット向上可能
- ❌ メモリ不均衡 (Attention重みもすべて保持する必要あり)
- ❌ パイプラインのバブル (最初のトークン生成まで待ち時間あり)

### 戦略C: ハイブリッド (Prism方式)
各ノードがAttention層+一部のExpertを保持。活性化パターンに基づいて配置最適化。
- ✅ ローカル実行比率が最大化される
- ✅ 各ノードで自己完結型推論が可能 (リモート呼び出し最小)
- ✅ Prismのアルゴリズムを応用可能
- ❌ メモリ要件が高い (Attention層を全ノードが保持)
- ❌ ノードが増えてもメモリ節約にならない部分がある

### 戦略比較 (Qwen3-30B-A3B, Q4量子化想定)

| 戦略 | ノード数 | Coordinatorメモリ | Expertメモリ/ノード | 通信/layer | 実装難易度 |
|------|----------|-------------------|--------------------|------------|-----------|
| A: EP | 9 (1+8) | 700MB | 224MB (1 Expert) | 64KB → 〜3MB/token | 高い |
| B: Pipeline | 4 (4層づつ) | 800MB | 800MB | 4KB (層境界のみ) | 中 |
| C: Hybrid | 3-5 | 800MB | 500MB-1GB | 変動 (ローカル優先) | 高い |
| **D: Speculative EP** | 9 (1+8) | 700MB | 224MB | Speculative予測で削減 | **非常に高い** |

## 6. 結論と勧告

### フェーズ0で確認すべき事項
1. `@huggingface/transformers` JS v4.2.0+ で Qwen3MoE / Qwen3MoE系のONNXモデルがロード可能か
2. WebGPU バックエンドで期待通りのパフォーマンスが出るか
3. ONNXモデルのMoE構造 (`com.microsoft.QMoE` ops) がPythonから解析可能か

### 技術的リスク
1. **ONNX MoE op の解析難易度**: QMoEは量子化重みを内包するカスタムop。内部構造のドキュメントが限定的
2. **通信レイテンシ**: 48層 × 8 expert = 384回/トークンの通信が必要。長文生成では数千回に
3. **ブラウザメモリ制限**: 単一タブのメモリ制限は通常 ~4GB。Coordinator部(~700MB) + KVcache + その他で余裕はあるが、Expert Workerも同様
4. **ブラウザのバックグラウンド制限**: タブがバックグラウンドになるとJS実行が制限される

### リスク低減策
1. **まず単一ブラウザ内MoEを検証** (Phase 0)
2. **トークンバッチ処理で通信を削減**: 4-8トークンをまとめて転送
3. **Speculative Dispatch**: 次層のルーター出力を予測し、事前にExpertを準備
4. **SharedArrayBuffer**: crossOriginIsolated環境でメモリ共有 (同一タブ内)

## 7. 参考文献リスト

1. Petals: Collaborative Inference and Fine-tuning of Large Models (NeurIPS 2023) - arXiv:2209.01188
2. Prism: Accelerating Edge Inference for Distributed MoE Models (arXiv:2508.12851, 2026)
3. Speculative MoE (ICML 2025) - arXiv:2503.04398
4. Semantic Parallelism (ICLR 2026) - OpenReview MSHPrMpIHZ
5. MoBiLE: Efficient MoE Inference on Consumer GPU (ASP-DAC 2026)
6. Qwen3 Technical Report (arXiv:2505.09388, 2025)
7. Mixture of Experts (MoEs) in Transformers (HuggingFace Blog, Feb 2026)
8. Transformers.js v4 (HuggingFace, 2026)
9. Accelerating MoE with Dynamic In-Switch Computing (arXiv:2605.05607, 2026)
10. Scaling Multi-Node MoE Inference Using Expert Activation Patterns (arXiv:2604.23150, 2026)
11. A Survey on Inference Optimization Techniques for MoE Models (arXiv:2412.14219, 2024)
12. MoE Model Inference on GPU Cloud (Spheron Blog, 2026)
13. VELA: Communication-Efficient MoE Fine-Tuning with Locality-Aware Expert Placement (ICDCS 2025)
