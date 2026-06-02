# MoE 分散推論 技術報告書

**プロジェクト**: flaxia-crowd 分散 MoE 推論
**作成日**: 2026-06-02
**対象モデル**: DeepSeek-V4-Flash (284B)
**テストモデル**: kshitijthakkar/deepseek-v4-mini-3B-init

---

## 目次

1. [DeepSeek-V4 アーキテクチャ詳細](#1-deepseek-v4-アーキテクチャ詳細)
2. [重み構造解析](#2-重み構造解析)
3. [分割設計](#3-分割設計)
4. [分散推論プロトコル設計](#4-分散推論プロトコル設計)
5. [通信レイテンシ予算](#5-通信レイテンシ予算)
6. [ブラウザメモリ解析](#6-ブラウザメモリ解析)
7. [量子化戦略](#7-量子化戦略)
8. [Expert 配置戦略](#8-expert-配置戦略)
9. [リスクアセスメント](#9-リスクアセスメント)
10. [実験計画](#10-実験計画)
11. [参考文献](#11-参考文献)

---

## 1. DeepSeek-V4 アーキテクチャ詳細

### 1.1 モデル全体構造

```
input_ids (batch, seq_len)
  │
  ├── Embedding (vocab_size × hidden_size)
  │
  ├── Layer 0:  Hash-routed MoE + dense Attention
  ├── Layer 1:  Hash-routed MoE + CSA Attention (compress_ratio=4)
  ├── Layer 2-27: Routed MoE + CSA/HCA Attention (compress_ratio交替)
  ├── Layer 28: Routed MoE + CSA Attention (compress_ratio=4)
  ├── Layer 29-57: Routed MoE + CSA/HCA Attention (compress_ratio交替)
  └── Layer 58-59: Routed MoE + dense Attention (compress_ratio=0)
       │
       ├── MTP Head (オプション補助損失用)
       └── LM Head (vocab_size)
            │
            logits
```

**パラメータ表**:

| パラメータ | 値 | 備考 |
|-----------|-----|------|
| `hidden_size` | 3072 | 全層共通の隠れ状態次元 |
| `num_hidden_layers` | 60 | Transformer層数 |
| `num_attention_heads` | 24 | query heads |
| `num_key_value_heads` | 1 | MQA (全query headが単一KV headを共有) |
| `head_dim` | 128 | 各attention headの次元 |
| `q_lora_rank` | — | V4では不使用 (V3互換パラメータ) |
| `o_lora_rank` | — | V4では不使用 |
| `o_groups` | 4 | output投影を4グループに分割 |
| `n_routed_experts` | 256 | ルーティング対象専門家数 |
| `n_shared_experts` | 1 | 共有専門家数 |
| `num_experts_per_tok` | 8 | shared (1) + routed top-7 |
| `num_hash_layers` | 2 | 最初の2層はhash-routed |
| `moe_intermediate_size` | 1536 | Expert FFNの拡大次元 |
| `vocab_size` | 129280 | DeepSeek独自tokenizer語彙数 |
| `max_position_embeddings` | 1048576 | YaRN拡張後の最大コンテキスト長 |
| `hc_mult` | 4 | mHC residual stream数 |

### 1.2 Attention: MQA + CSA/HCA Hybrid

**MQA (Multi-Query Attention)**:
```
Q = x @ W_q        → [batch, seq, 24 heads × 128] = [b, s, 3072]
K = x @ W_k        → [batch, seq, 1 head × 128]   = [b, s, 128]
V = x @ W_v        → [batch, seq, 1 head × 128]   = [b, s, 128]

# K, V を全24 query headにブロードキャスト
# 各head:
score[h] = softmax(Q[h] @ K^T / sqrt(128))     → [b, s, s]
out[h]   = score[h] @ V                         → [b, s, 128]

# 全head連結 + output投影:
out = concat(out[0..23]) @ W_o                  → [b, s, 3072]
```

MQAによりKVキャッシュは dense attention の 1/24 に削減。

**CSA (Compressed Sparse Attention)**:
```
# Step 1: KV圧縮 (lightweight projection)
K_compressed = K @ W_compress     [128 → 64]
V_compressed = V @ W_compress     [128 → 64]

# Step 2: DSA (DeepSeek Sparse Attention) Indexer
# Learned indexer が各queryに対してtop-kのkey位置を選択
indexer_score = x @ W_indexer     → [b, s, index_head_dim]
index_topk = top_k(indexer_score, k=192)

# Step 3: 選択された位置のみ attention
scores = Q @ K_selected^T
weights = softmax(mask(scores))
output = weights @ V_selected
```

**HCA (Heavily Compressed Attention)**:
CSAよりさらに強力な圧縮:
```
# より小さな次元に圧縮
K_hca = K @ W_hca_compress       [128 → 32]
V_hca = V @ W_hca_compress       [128 → 32]

# dense attention over compressed keys
output = softmax(Q_hca @ K_hca^T / sqrt(32)) @ V_hca
```

**compress_ratios 配列** (60層分):
```
[0, 0, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112,
 4, 112, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112,
 4, 112, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112,
 4, 112, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112, 4, 112,
 4, 0]
```

意味:
- `0`: dense attention (層0, 1, 59) — 通常の全結合attention
- `4`: CSA (圧縮率4) — activeなKVのみattention
- `112`: HCA (強圧縮) — ほぼ全KVを圧縮してdense attention

これにより1MコンテキストでもAttentionの計算量をV3比 **27%** に削減。

### 1.3 mHC (Manifold-Constrained Hyper-Connections)

**問題設定**:
従来のResidual接続: `output = layer(hidden) + hidden`
mHCは4つの並列residual streamをSinkhorn-Knopp反復で混合する。

**数学的定式化**:

各層の入力で4つのstreamを持つ:
```
s_0, s_1, s_2, s_3  ∈ R^{batch × hidden}  (4 streams)
```

**Step 1: Sinkhorn-Knopp正則化**:

各head h について、4×4のattention行列 A_h を計算:
```
A_h[i][j] = softmax_j( s_i @ W_qh @ (s_j @ W_kh)^T )
```

Sinkhorn-Knopp反復で2重確率行列に正則化:
```
for _ in range(n_iter):
    A_h = normalize_rows(A_h)   # 各行の和=1
    A_h = normalize_cols(A_h)   # 各列の和=1
```

**Step 2: 重み付き混合**:

```
for i in 0..3:
    s'_i = sum_j A_h[i][j] * s_j  (各headを平均)
```

**Step 3: FFN + 出力収縮**:

各streamに独立したFFN:
```
s''_i = FFN_i(s'_i)
```

学習可能な収縮ベクトル `hc_head` で最終出力に射影:
```
output = sum_i s''_i * hc_head[i]
```

**flaxia実装上注意**:
- Sinkhorn-Knopp反復 (通常3-5 iter) は逐次処理 → WASMではSIMD活用
- 4-streamはCoordinator側で保持（Expert Workerとの通信不要）
- メモリ: 4 × hidden × num_layers = 4 × 3072 × 60 × 2bytes ≈ 1.4MB (negligible)

### 1.4 MoE Routing

**sqrt(softplus) + expert bias**:

DeepSeek-V4は従来のsoftmax routingではなく、バイアス項を分離:

```
# Router: hidden → expert scores
router_logits = x @ W_router           → [batch, 256] (各expertのスコア)

# Step 1: sqrt(softplus) activation
scores = sqrt(softplus(router_logits))  # √ln(1+e^x)

# Step 2: expert bias 加算 (学習可能、load balancing用)
biased = scores + expert_bias           # [batch, 256]

# Step 3: top-7 selection (shared expert は常に含む)
topk_indices, topk_weights = top_k(biased, k=7)

# Step 4: 重み正規化
gate = softmax(topk_weights)            # 選択された7個の重み
```

**Hash-routed MoE (最初の2層)**:
```
# 決定論的マッピング: vocab_id → expert_id
hash = hash_function(input_ids)         # 固定ハッシュ
expert_id = hash % num_experts
# Router不使用。全トークンが固定expertに割り当てられる
```

**Shared Expert**:
```
# 全トークンが常に通る共有FFN
shared_out = shared_ffn(hidden)
# 最終出力 = shared_out + sum(gate[i] * expert_out[i])
```

### 1.5 Clamped SwiGLU

V4のExpert FFNは標準SwiGLUにclampingを追加:

```
# Gate投影
gate = x @ W_gate              → [batch, intermediate_size]

# Up投影  
up = x @ W_up                  → [batch, intermediate_size]

# SwiGLU活性化 (clamping付き)
gate_swish = gate * sigmoid(gate)
gate_swish = clamp(gate_swish, min=-10.0, max=10.0)

# 要素積
hidden = gate_swish * up

# Down投影
output = hidden @ W_down        → [batch, hidden_size]
```

clampingは低精度 (int4/int8) での計算安定性向上が目的。

### 1.6 Multi-Token Prediction (MTP)

V4は次のトークンのみでなく、さらに先のトークンも予測する補助headを持つ:

```
# メインhead: 次のトークン
logits = lm_head(hidden_N)              → [vocab_size]

# MTP head: さらに1つ先のトークン
mtp_hidden = mtp_transform(hidden_N)    # 軽量MLP
mtp_logits = mtp_head(mtp_hidden)       → [vocab_size]

# 損失: main_loss + mtp_loss_weight * mtp_loss
```

**flaxiaへの影響**: MTPは**トレーニング時のみ有効**。推論時はメインheadのみ使用するため、MTP headのONNXエクスポートは不要（ただしモデル構造を理解した上でスキップする判断が必要）。

---

## 2. 重み構造解析

### 2.1 全テンソル一覧

`deepseek-ai/DeepSeek-V4-Flash` のチェックポイントに含まれる全テンソルとその分類:

| カテゴリ | テンソル名 (パターン) | Shape | パラメータ数 | 容量(bf16) |
|----------|----------------------|--------|-------------|-----------|
| **Embedding** |
| | `model.embed_tokens.weight` | [129280, 3072] | 397M | 794MB |
| **Attention (層i, 0..59)** |
| | `model.layers.{i}.self_attn.q_proj.weight` | [3072, 3072] | 9.44M | 18.9MB |
| | `model.layers.{i}.self_attn.k_proj.weight` | [128, 3072] | 394K | 0.8MB |
| | `model.layers.{i}.self_attn.v_proj.weight` | [128, 3072] | 394K | 0.8MB |
| | `model.layers.{i}.self_attn.o_proj.weight` | [3072, 3072] | 9.44M | 18.9MB |
| **CSA/HCA (層i)** |
| | `model.layers.{i}.self_attn.k_compress.weight` | [64, 128] | 8K | 16KB |
| | `model.layers.{i}.self_attn.v_compress.weight` | [64, 128] | 8K | 16KB |
| | `model.layers.{i}.self_attn.indexer.weight` | [96, 3072] | 295K | 0.6MB |
| **mHC (層i)** |
| | `model.layers.{i}.hc_attn.q.weight` | [16, 3072, 4] | 197K | 0.4MB |
| | `model.layers.{i}.hc_attn.k.weight` | [16, 3072, 4] | 197K | 0.4MB |
| | `model.layers.{i}.hc_ffn.weight` | [3072, 3072, 4] | 37.7M | 75.5MB |
| | `model.layers.{i}.hc_head.weight` | [3072, 4] | 12K | 24KB |
| **Router (層i, hash層以外)** |
| | `model.layers.{i}.mlp.gate.weight` | [256, 3072] | 786K | 1.6MB |
| | `model.layers.{i}.mlp.gate.bias` | [256] | 256 | 512B |
| | `model.layers.{i}.mlp.gate.e_score_correction` | [256] | 256 | 512B |
| **Shared Expert (層i, hash層以外)** |
| | `model.layers.{i}.mlp.shared_experts.gate.weight` | [1536, 3072] | 4.72M | 9.4MB |
| | `model.layers.{i}.mlp.shared_experts.up.weight` | [1536, 3072] | 4.72M | 9.4MB |
| | `model.layers.{i}.mlp.shared_experts.down.weight` | [3072, 1536] | 4.72M | 9.4MB |
| **Routed Expert (層i, expert j)** |
| | `model.layers.{i}.mlp.experts.{j}.gate.weight` | [1536, 3072] | 4.72M | 9.4MB |
| | `model.layers.{i}.mlp.experts.{j}.up.weight` | [1536, 3072] | 4.72M | 9.4MB |
| | `model.layers.{i}.mlp.experts.{j}.down.weight` | [3072, 1536] | 4.72M | 9.4MB |
| **Output Head** |
| | `model.lm_head.weight` | [129280, 3072] | 397M | 794MB |
| | `model.lm_head.e_proj.weight` | [3072, 3072] | 9.44M | 18.9MB |
| | `model.lm_head.h_proj.weight` | [3072, 3072] | 9.44M | 18.9MB |
| **MTP Head** |
| | `model.mtp_head.shared_head.weight` | [129280, 3072] | 397M | 794MB |
| | `model.mtp_head.h_proj.weight` | [3072, 3072] | 9.44M | 18.9MB |

### 2.2 Coordinator vs Expert 分類

```
Coordinator保持:
├── Embedding: embed_tokens.weight
├── Attention (60層): q/k/v/o_proj, k/v_compress, indexer
├── mHC (60層): hc_attn.q/k, hc_ffn, hc_head
├── Router (58層): gate.weight/bias/e_score_correction
├── Shared Expert (58層): shared_experts.gate/up/down
├── Output Head: lm_head.weight + e_proj/h_proj
└── LayerNorm等: input_layernorm, post_attention_layernorm

Expert j 保持 (各層):
└── experts.{j}.gate.weight (or merged gate_up)
    experts.{j}.up.weight   (or merged)
    experts.{j}.down.weight
```

**重要**: V4-Flashのチェックポイントでは gate と up が `gate_up_proj` として
連結されている可能性がある (Transformers v5 WeightConverter仕様)。
```
# 分離前: gate_up_proj.shape = [2 * intermediate_size, hidden_size] = [3072, 3072]
# 分離後: gate.weight = gate_up_proj[:intermediate_size]
#         up.weight   = gate_up_proj[intermediate_size:]
```

### 2.3 Mini-3B vs V4-Flash スケール比較

テストモデル (`kshitijthakkar/deepseek-v4-mini-3B-init`) を使った開発後、
V4-Flashに移行する際のスケーリング差異:

| パラメータ | Mini-3B | V4-Flash | 倍率 |
|-----------|---------|----------|-------|
| hidden_size | 1536 | 3072 | 2x |
| layers | 28 | 60 | 2.1x |
| routed experts | 24 | 256 | 10.7x |
| top_k | 4 | 7 | 1.8x |
| intermediate_size | 768 | 1536 | 2x |
| vocab_size | 129280 | 129280 | 1x |
| 総パラメータ | 3.2B | 284B | 89x |

Mini-3Bは構造が同一なため、以下の検証が可能:
- 重み分割ロジック (キー名パターン)
- Coordinator ONNXエクスポート
- Expert SwiGLU ONNXエクスポート
- 分割後モデルの推論一致確認

V4-Flash移行時の変更点:
- テンソル次元の拡大 (ただしコードは同一パターン)
- Expert数の増加 (24→256、出力ファイル数増)
- `gate_up_proj` 連結形式の対応

---

## 3. 分割設計

### 3.1 変換パイプライン全体図

```
┌─────────────────────────────────────────────────────────────────┐
│                       convert-moe-model.py                       │
│                                                                   │
│  Step 1: モデルロード                                              │
│  ├── config.json → 構造情報                                       │
│  └── *.safetensors → state_dict                                   │
│                                                                   │
│  Step 2: 重み分類                                                  │
│  ├── coordinator_keys = [k for k in state_dict                    │
│  │                       if not is_expert_weight(k)]              │
│  └── expert_keys = {expert_id: [gate, up, down]}                  │
│                                                                   │
│  Step 3: Coordinator safetensors出力                               │
│  ├── coordinator/model.safetensors (全非Expert重み)               │
│  └── coordinator/model.onnx (torch.onnx.export)                  │
│                                                                   │
│  Step 4: Expert safetensors出力 (並列)                             │
│  ├── experts/expert_0000/model.safetensors                        │
│  ├── experts/expert_0000/model.onnx                               │
│  ├── experts/expert_0001/model.safetensors                        │
│  ├── ...                                                          │
│                                                                   │
│  Step 5: 検証 (オプション --verify)                                │
│  └── 元モデル vs 分割モデル 出力比較                                │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Coordinator PyTorch モデル定義

Coordinator ONNX export用のPyTorchモデル定義:

```python
class CoordinatorModel(torch.nn.Module):
    """非Expert部分のみ。Router重みを含む（ゲート計算はTS実装）。"""

    def __init__(self, config, state_dict):
        super().__init__()
        self.embed = Embedding(config.vocab_size, config.hidden_size)
        self.layers = nn.ModuleList([
            CoordinatorLayer(config, i) for i in range(config.num_hidden_layers)
        ])
        self.norm = LayerNorm(config.hidden_size)
        self.lm_head = Linear(config.hidden_size, config.vocab_size)

    def forward(self, input_ids):
        h = self.embed(input_ids)
        router_outputs = []  # (expert_indices, router_weights)
        for i, layer in enumerate(self.layers):
            h, router_out = layer(h, i)
            router_outputs.append(router_out)
        h = self.norm(h)
        logits = self.lm_head(h)
        return logits, router_outputs
```

**注意**: Routerの `expert_indices` + `weights` はONNXの出力として露出させる必要がある（TS側でExpert呼び出しに使用）。

### 3.3 Expert ONNX グラフ

各Expertは独立したSwiGLU FFNとしてONNXエクスポート:

```python
class ExpertFFN(torch.nn.Module):
    """単一ExpertのSwiGLU FFN。ONNXエクスポート用の独立モジュール。"""

    def __init__(self, gate_weight, up_weight, down_weight, hidden_size, intermediate_size):
        super().__init__()
        self.gate = nn.Linear(hidden_size, intermediate_size, bias=False)
        self.up = nn.Linear(hidden_size, intermediate_size, bias=False)
        self.down = nn.Linear(intermediate_size, hidden_size, bias=False)
        # 重みを直接セット
        self.gate.weight.data = gate_weight
        self.up.weight.data = up_weight
        self.down.weight.data = down_weight

    def forward(self, x):
        gate = self.gate(x)
        gate_swish = gate * torch.sigmoid(gate)  # SiLU
        gate_swish = torch.clamp(gate_swish, -10.0, 10.0)  # V4 clamped SwiGLU
        up = self.up(x)
        hidden = gate_swish * up
        return self.down(hidden)
```

ONNXエクスポート設定:
- opset: 21 (SiLU不要 → Sigmoid + Mul)
- dynamic_axes: batch次元のみ (seq_len=1固定で良いかも)
- input: `hidden_states` [batch, 3072]
- output: `expert_output` [batch, 3072]

### 3.4 検証手法

分割の正しさを検証するプロトコル:

```
検証1: Coordinator単体
  入力: ランダムinput_ids
  確認: Router出力 (indices + weights) が元モデルと一致
  確認: Attention + Shared Expert 出力が元モデルと一致

検証2: Expert単体
  入力: ランダムhidden_states (固定seed)
  確認: Expert FFN出力が元モデルの該当Expert出力と一致 (atol=1e-3)

検証3: 結合推論
  1. Coordinatorで全層のrouter_indices/weightsを取得
  2. 各層で該当Expertを呼び出し
  3. 重み付き和 + Shared Expert出力 を計算
  4. 最終出力logitsが元モデルと一致 (atol=1e-2, bf16誤差許容)
```

bf16の数値誤差許容範囲:
- 単一MatMul: ~1e-6 (fp32) vs ~1e-2 (bf16)
- 58層積算: 誤差が蓄積する可能性あり
- atol=1e-2 程度を許容

---

## 4. 分散推論プロトコル設計

### 4.1 プロトコル階層

```
Layer 3: MoE 推論プロトコル (EDP: Expert Dispatch Protocol)
─────────────────────────────────────────────────────────
  EDP.Request / EDP.Response / EDP.Heartbeat
  - セマンティックなMoEメッセージ

Layer 2: メッセージ転送プロトコル (MTP: Message Transport Protocol)
─────────────────────────────────────────────────────────
  - フラグメンテーション / 再構成
  - シリアライゼーション (MessagePack vs FlatBuffers)
  - 暗号化 (optional)

Layer 1: トランスポート (Transport)
─────────────────────────────────────────────────────────
  Phase 2: Cloudflare Relay (WebSocket)
  Phase 3: WebRTC DataChannel (P2P)
  Fallback: HTTP Long-polling
```

### 4.2 EDP メッセージ定義

**EDP.Request** (Coordinator → Expert):
```
message_id:    uint64          # 一意のメッセージID
layer_index:   uint32          # 当前層 (0..59)
expert_ids:    uint32[7]       # 活性化された7個のexpert ID
hidden_states: float32[7][3072] # 各expertへの入力 (top-7分)
token_count:   uint32          # バッチ内トークン数
timestamp:     uint64          # 送信タイムスタンプ
coordinator_id: string         # Coordinator識別子
```

**EDP.Response** (Expert → Coordinator):
```
message_id:    uint64          # Requestに対応
expert_id:     uint32          # このレスポンスのexpert ID
output:        float32[3072]   # FFN出力 (1トークン分)
error_code:    uint32          # 0=success, 1=timeout, 2=model_unloaded
timestamp:     uint64          # 計算終了タイムスタンプ
```

**EDP.Heartbeat** (双方向):
```
message_type:  uint8 = 0x01
node_id:       string
timestamp:     uint64
expert_ids:    uint32[]         # Expertノードの担当expert一覧
load:          float32          # 現在の負荷 (0.0-1.0)
memory_free:   uint64           # 空きメモリ (bytes)
```

### 4.3 シリアライゼーション比較

| 方式 | サイズ | エンコード時間 | デコード時間 | ブラウザ対応 |
|------|--------|--------------|-------------|------------|
| JSON | 大 (base64 binary) | 中 | 中 | ✅ 標準 |
| MessagePack | 小 (生binary) | 速い | 速い | ✅ msgpack-lite |
| FlatBuffers | 最小 (zero-copy) | 最速 | 最速 (no parse) | ⚠️ 要schema |
| CBOR | 小 | 速い | 速い | ⚠️ 要ライブラリ |

**推奨**: Phase 1-B (同一タブ) → 単にFloat32Arrayのまま送信 (zero-copy via SharedArrayBuffer)
Phase 2 (リレー経由) → MessagePack (JSONより2-3x効率的, 実装容易)
Phase 3 (WebRTC) → FlatBuffers or 独自binary (ブラウザの型付配列を直接転送)

### 4.4 フラグメンテーション

WebRTC DataChannelの最大メッセージサイズ制限 (Chrome 256KB, Firefox 64KB)
に対応するための分割:

```
1 Expert分の hidden_state: 3072 × 4bytes = 12KB
7 Experts分: 7 × 12KB = 84KB  → 単一メッセージに収まる ✅

バッチ4トークン: 4 × 84KB = 336KB  → ChromeはOK, Firefoxは分割必要
  → Firefox: 64KB単位に分割 (6 fragments)
```

### 4.5 Expert Dispatch シーケンス

```
Coordinator                    Relay                      Expert Node(s)
    │                            │                            │
    │  Step 1: 全層のRouter出力を計算                          │
    │  router[i] = softmax(sqrt(softplus(hidden @ W_r)))      │
    │  indices[i], weights[i] = top_k(router[i], k=7)         │
    │                            │                            │
    │  Step 2: 全Expertに一斉Dispatch                          │
    │  for layer in 0..59:                                     │
    │    for idx in indices[layer]:                            │
    │      msg = {expert_id: idx, hidden: h}                   │
    │      │──── EDP.Request ───────────────────────────────►  │
    │      │                            │                      │
    │      │                            │   Expert FFN forward  │
    │      │                            │                      │
    │      │◄── EDP.Response ───────────────────────────────│  │
    │                            │                            │
    │  Step 3: 結果を集約                                        │
    │  output = shared_expert(h)                                │
    │  for idx, w in zip(indices[layer], weights[layer]):       │
    │    output += w * expert_results[idx]                      │
    │                            │                            │
    │  Step 4: 次層へ                                           │
    │  h = mhc_mixing(output)                                    │
    │  h = attention(h)                                         │
    │  ...repeat from Step 1                                   │
```

**重要**: 全58層 × 7 = 406回のリモート呼び出しが1トークン生成あたり発生。
各呼び出しのRTTが10msだと、通信だけで 406 × 10ms = 4.06秒。

**最適化**: 全Expertへのディスパッチを並列化 (Promise.all) + バッチ処理。
```
# Before (逐次): 406 × RTT
for layer in 0..59:
  for expert in topk[layer]:
    await dispatch(expert, h)

# After (並列): 58 × RTT (全Expertを1度にdispatch)
for layer in 0..59:
  results = await Promise.all([
    dispatch(expert, h) for expert in topk[layer]
  ])

# After (バッチ): 1 × RTT (全層の全Expertをまとめてdispatch)
all_dispatches = []
for layer in 0..59:
  for expert in topk[layer]:
    all_dispatches.append(dispatch(layer, expert, h))
results = await Promise.all(all_dispatches)
```

---

## 5. 通信レイテンシ予算

### 5.1 詳細レイテンシブレークダウン

1トークン生成あたり (プリフィルなし、逐次デコード想定):

| フェーズ | 時間 (推定) | 備考 |
|---------|------------|------|
| Embedding | < 1ms | 単一Gather |
| 60層 Attention | ~10ms | MQA, CSA/HCA |
| 60層 mHC | ~5ms | Sinkhorn-Knopp 3 iter |
| 58層 Router | ~3ms | 1 MatMul + top-k |
| 58層 Shared Expert | ~5ms | 3 MatMul |
| 58層 × 7 Expert 通信 | 58 × RTT | **ボトルネック** |
| 58層 Expert結果集約 | < 1ms | 重み付き和 |
| Output Head | ~2ms | 1 MatMul |
| **合計 (RTT=10ms)** | **~605ms/token** | 通信が95% |
| **合計 (RTT=1ms)** | **~80ms/token** | 同一LAN |
| **合計 (バッチ4)** | **~100ms/token** | RTT=5ms想定 |

### 5.2 通信ボトルネック詳細

ネットワーク条件別の1トークン生成時間:

```
RTT (ms) |  逐次  | 層並列 | 全並列+バッチ4
---------|--------|--------|---------------
   1     |  115ms |   70ms |    35ms
   5     |  375ms |  130ms |    55ms
  10     |  675ms |  170ms |    80ms
  20     |  1.27s |  310ms |   130ms
  50     |  2.97s |  590ms |   230ms
 100     |  5.87s |  1.12s |   420ms  (Relay経由想定)
```

- 逐次: 1層ずつ通信 → 58層 × 1回RTT
- 層並列: 各層の7 Expertを並列dispatch → 58層 × 1回RTT
- 全並列+バッチ4: 全58層×7 Expertを一斉dispatch → 1回のRTT

**結論**: 同一LAN (RTT ~1-5ms) であれば実用域。
インターネット経由 (RTT ~20-50ms) ではバッチ/並列化が必須。
Cloudflare Relay (RTT ~10-50ms) では全並列+バッチ4が必要。

### 5.3 Speculative Dispatch 効果

Speculative MoE (ICML 2025) の手法を適用した場合の推定改善:

```
前提: Routerの出力は層間で相関が高い
  → Layer i の top-7 Expert は Layer i+1 でも top-7 に含まれる確率が高い

予測的中率: ~70% (Prism論文の知見に基づく)

効果:
  - 予測的中時: 事前にhidden状態を送信済み → RTT削減
  - 予測失敗時: 再送信が必要

通信削減量 (推定):
  - 70%的中: 58層 × 7 × 0.3 = 122回 (本来406回 → 122回 = 70%削減)
  - 実効RTT: 58 (予測成功) + 122 (再送) = 180回相当
```

---

## 6. ブラウザメモリ解析

### 6.1 Coordinator メモリ使用量 (bf16)

| コンポーネント | パラメータ数 | 容量 | 備考 |
|--------------|-------------|------|------|
| Embedding | 397M | 794MB | vocab_size × hidden |
| Attention (60層) | ~620M | ~1.24GB | Q:9.44M, K/V:0.39M×2, O:9.44M, +CSA/HCA/mHC |
| Router (58層) | ~45.6M | ~91MB | gate.weight + bias + e_score |
| Shared Expert (58層) | ~820M | ~1.64GB | 58 × 3 × 4.72M |
| Output Head | 397M | 794MB | lm_head.weight |
| LayerNorm (60層×2) | ~0.74M | ~1.5MB | weight+bias per layer |
| **Coordinator計** | **~2.28B** | **~4.56GB** | **過大** |

### 6.2 量子化後の現実的なメモリ (int8)

| コンポーネント | 容量 |
|--------------|------|
| Embedding (int8) | ~397MB |
| Attention (int8) | ~620MB |
| Router (fp16, 精度重要) | ~91MB |
| Shared Expert (int8) | ~820MB |
| Output Head (int8) | ~397MB |
| LayerNorm (fp32) | ~3MB |
| **KV Cache (1K ctx)** | ~60MB |
| **Runtime overhead** | ~200MB |
| **Coordinator計 (int8)** | **~2.6GB** |

### 6.3 Expert Worker メモリ使用量

| 条件 | 1 Expert | 4 Expert | 8 Expert |
|------|---------|---------|---------|
| bf16 | ~27MB | ~108MB | ~216MB |
| int8 | ~13.5MB | ~54MB | ~108MB |
| int4 | ~6.75MB | ~27MB | ~54MB |
| +Runtime overhead | +~50MB | +~100MB | +~150MB |

### 6.4 ブラウザメモリ制限との比較

| 環境 | 制限 | Coordinator(int8) | Expert×8(int4) | 余裕 |
|------|------|-------------------|----------------|------|
| Chrome Desktop | ~4GB/tab | 2.6GB | 0.2GB | **~1.2GB** |
| Chrome Android | ~2GB/tab | 2.6GB | — | **超過** |
| Firefox Desktop | ~4GB/tab | 2.6GB | 0.2GB | **~1.2GB** |
| Safari Desktop | ~4GB/tab | 2.6GB | 0.2GB | **~1.2GB** |

**課題**: デスクトップChromeではギリギリ動作可能だが、モバイルではCoordinator単体でも超過。
**対策**: Shared Expertを別ノードに分離 or さらなる量子化 (int4 Coordinatorは精度リスク大)。

---

## 7. 量子化戦略

### 7.1 各コンポーネントの量子化耐性

| コンポーネント | 量子化耐性 | 推奨dtype | 根拠 |
|--------------|-----------|-----------|-------|
| Embedding | 高い | int8 | ルックアップテーブル、精度影響小 |
| Attention Q/K/V | 中 | int8 | 計算誤差がattention分布に影響 |
| Attention O | 中 | int8 | 同上 |
| Router | **低い** | fp16 | top-k selectionが精度に敏感 |
| Shared Expert | 高い | int8 | FFNは量子化耐性高 |
| Routed Expert | **非常に高い** | int4 | MoBE論文でも確認済み |
| Output Head | 高い | int8 | 最終logit、top-1 selectionには十分 |
| mHC | 中 | int8 | Sinkhorn反復は誤差を蓄積しやすい |

### 7.2 量子化方式

| 方式 | 精度 | サイズ比 | 計算オーバーヘッド | 推奨 |
|------|------|---------|------------------|------|
| RTN (Round-To-Nearest) | 低 | 0.25x (int4) | なし | Expert用 |
| GPTQ | 高 | 0.25x (int4) | 高い (calibration要) | 時間があれば |
| AWQ | 高 | 0.25x (int4) | 中 | Shared Expert用 |
| GGML quantization | 中 | 0.25-0.5x | 低 | バックアップ案 |

**Phase 1-A**: RTN (単純なmin-max量子化) でまず動かす。
**Phase 3**: GPTQ/AWQで品質改善。

### 7.3 通信量子化

hidden_states の転送時量子化:

```
fp16:  3072 × 2bytes = 6KB / expert (精度維持, 帯域大)
int8:  3072 × 1bytes = 3KB / expert (帯域半減, 精度影響小)
int4:  3072 × 0.5bytes = 1.5KB / expert (帯域1/4, 精度影響中)
```

**推奨**: Phase 2 までは fp16 で通信。Phase 3 で int8 に切り替え。
int4 通信は精度劣化リスクに見合う帯域削減効果が不明なため見送り。

---

## 8. Expert 配置戦略

### 8.1 256 Expert のノード割当

前提: Coordinator 1台 + Expert Worker N台

| シナリオ | Worker数 | Expert/Worker | メモリ/Worker | カバレッジ |
|---------|---------|--------------|-------------|-----------|
| 最低限 | 32 | 8 | ~216MB (bf16) | 256全カバー |
| 推奨 | 64 | 4 | ~108MB (bf16) | 256全カバー + 余裕 |
| 冗長化 | 96 | 4 (一部重複) | ~108MB | ホットExpert複製 |
| 軽量 | 16 | 16 | ~432MB | 256全カバー (メモリ大) |

1 Workerあたりのメモリ:
- int4量子化: 1 Expert = 6.75MB
- 8 Expert: ~54MB (余裕あり)
- 32 Expert: ~216MB (まだ現実的)

**理想構成**: 32 Worker、各8 Expert (int4)、ホットExpert複製用に+8台予備。

### 8.2 活性化パターン分析

Prism論文の知見をV4-Flashに適用:

```
前提: V4-Flashの256 Expertの活性化はZipf分布に従う
  → 一部のExpert (〜20%) がほとんどのトークンで活性化される

具体的仮説:
  - Top-20% Expert (≈51個): 80%のトークンで活性化
  - Bottom-50% Expert (≈128個): 5%未満のトークンでしか活性化されない

配置戦略:
  - ホットExpert (51個): 複数ノードに複製 (各3-4コピー)
  - コールドExpert (128個): 1ノードのみ、動的ロード
  - 通常Expert (残り77個): 2ノードずつ分散
```

この戦略により、全256 Expertの物理カバレッジを保ちつつ、
トークンあたりの通信をホットExpertの局所性で削減可能。

### 8.3 動的ロード/アンロード

コールドExpertのメモリ管理:

```
状態遷移:
  UNLOADED → LOADING → READY → EVICTING → UNLOADED

LOADING: safetensorsから読み込み + ONNX session作成 (~100ms)
EVICTING: ONNX session破棄 + メモリ解放 (~10ms)

トリガー:
  - Routerが未ロードのExpertを要求 → 即時LOAD
  - メモリ逼迫 → LRU方式でEVICT
  - プリフェッチ: Speculative Dispatchと連動

目標: ホットExpertは常駐、コールドExpertは要求時にロード
```

---

## 9. リスクアセスメント

### 9.1 技術リスク一覧

| # | リスク | 確率 | 影響 | 対策 | 優先度 |
|---|--------|------|------|------|--------|
| R1 | Coordinator ONNXエクスポート失敗 (mHC等カスタムop) | 高 | 致命的 | PyTorch→ONNXのopセット制限を事前調査。代替: ONNX非対応部はTS実装 | 🔴 |
| R2 | ブラウザメモリ不足 (Coordinator 2.6GB@int8 + オーバーヘッド) | 中 | 致命的 | Shared Expert分割, 段階的ロード, WebGL/WebGPUメモリ制限確認 | 🔴 |
| R3 | 58層 × 7 = 406回/token の通信レイテンシ | 高 | 大 | 並列化+バッチ処理+Speculative Dispatchで削減 | 🟠 |
| R4 | bf16 ONNXモデルのブラウザ推論速度 | 中 | 大 | WebGPU backend利用, int8/int4量子化で高速化 | 🟠 |
| R5 | Expertノード離脱時の推論品質低下 | 中 | 中 | top-7中欠落 → top-6で代用。品質影響の事前測定 | 🟡 |
| R6 | MTP headを含むモデル構造の複雑さ | 低 | 中 | MTP headは推論不使用。正しくスキップする実装が必要 | 🟡 |
| R7 | hash-routed layer (最初の2層) の特殊処理 | 低 | 低 | 全トークン固定expert割当。通常のroutingとの統合 | 🟢 |
| R8 | gate_up_proj 連結形式の対応漏れ | 中 | 中 | Transformers v5 WeightConverterの確認必須 | 🟡 |

### 9.2 リスク R1 詳細: ONNXエクスポート

**問題**: DeepSeek-V4には以下のカスタムop相当の処理が含まれる:
- Sinkhorn-Knopp反復 (mHC): ループを含む制御フロー
- DSA Indexer (CSA): top-k selection + gather
- 条件分岐 (compress_ratioによるattention切替)

**ONNXエクスポートの制限**:
- 動的ループ → ONNX Loop op で表現可能 (torch.onnx.export は `torch.where` で分岐)
- top-k → ONNX TopK op で表現可能
- 条件分岐 → ONNX If op or マスク演算で表現可能

**現実的なアプローチ**:
- **Phase 1-Aの目標を限定**: Coordinator ONNXは完全な自動エクスポートを目指さない
- **代替**: ONNXは標準Transformer部分 (Embedding, MQA, FFN, OutputHead) のみ
- **カスタム部**: mHC, CSA/HCA, Router はTypeScriptで直接実装（PyTorchコードを参考に）
- これによりONNXの制約に悩まされず、TS実装の独立性が高まる

**修正アーキテクチャ** (R1対策後):
```
Coordinator TS Pipeline:
  ├── ONNX: Embedding + Shared Expert FFN + OutputHead (標準opのみ)
  ├── TS実装: MQA Attention (カスタマイズ可能)
  ├── TS実装: mHC (Sinkhorn-Knopp反復)
  ├── TS実装: CSA/HCA Attention (条件分岐含む)
  └── TS実装: Router (softmax/sqrt/softplus/top-k)
```

### 9.3 リスク R2 詳細: ブラウザメモリ

**問題**: Chromeのタブあたりメモリ制限は~4GBだが、
OS/他のタブの使用量により実質的な利用可能メモリはさらに少ない。

**対策フェーズ**:
```
Phase 1-B (同一タブ):
  - Coordinator + 数Expertのみ (メモリ制限厳守)
  - 検証用: Mini-3Bモデル (Coordinator ~200MB)

Phase 2 (マルチノード):
  - Coordinator 1タブ + Expert各タブ
  - Coordinatorメモリ節約: int8 + Shared Expert分離オプション

Phase 3 (最適化):
  - Shared Expertも別ノードに分離
  - Coordinator: Embedding+Attention+Router+OutputHead → ~1.2GB (int8)
  - ブラウザ制限内に収まる
```

### 9.4 Mini-3B → V4-Flash 移行リスク

テストモデルから実モデルへの移行時に想定される問題:

| 項目 | Mini-3B | V4-Flash | 移行リスク |
|------|---------|----------|-----------|
| hidden_size | 1536 | 3072 | 低 (コード変更なし) |
| 層数 | 28 | 60 | 低 (ループ変数のみ) |
| Expert数 | 24 | 256 | 低 (ファイル出力数の増加のみ) |
| gate_up_proj | 分離 | 連結の可能性 | **中** (WeightConverter確認必須) |
| int4量子化 | 不要 | 必須 | 中 (量子化コードの追加) |
| メモリ | 数百MB | 数GB | **高** (ブラウザ制限) |
| チェックポイント容量 | ~5GB | ~500GB | **高** (ダウンロード不可能) |

**V4-Flashチェックポイント入手手段**:
1. HuggingFaceからの直接ダウンロード: **非現実的** (500GB+)
2. 分割ダウンロード + 逐次変換: 可能だが時間がかかる
3. **推奨**: HuggingFace上で変換スクリプトを実行し、Coordinator/Expertに分割した結果のみをダウンロード

---

## 10. 実験計画

### 10.1 Mini-3B を用いた検証計画

```
Phase 1-A (Python):
  [x] test_model_loader.py     - モデルロード・構造解析
  [x] test_weight_splitter.py   - 重み分類・分割
  [x] test_coordinator_builder.py - Coordinator ONNX export
  [x] test_expert_builder.py    - Expert ONNX export
  [x] test_integration.py       - 分割→再結合で元モデルと一致確認

Phase 1-B (TypeScript):
  [ ] test_expert_onnx.ts       - Expert ONNX session実行
  [ ] test_moe_coordinator.ts   - Coordinator単体推論
  [ ] test_expert_pool.ts       - Expert Pool (Web Worker) 実行
  [ ] test_full_pipeline.ts     - Coordinator + Expert 結合推論
  [ ] test_vs_pytorch.py        - TS出力 vs PyTorch出力 比較

Phase 2 (分散):
  [ ] test_edp_protocol.ts      - EDPメッセージ送受信
  [ ] test_relay_integration.ts - Cloudflare Relay経由推論
  [ ] test_end_to_end.ts        - 2タブ分散推論
```

### 10.2 評価指標

| 指標 | 目標値 | 測定方法 |
|------|--------|---------|
| 分割後モデルの出力一致率 | atol=1e-2, rtol=0.01 | Pythonで元モデルと比較 |
| 単一タブ推論速度 | > 1 token/sec (Mini-3B) | performance.now() |
| 分散推論速度 | > 0.5 token/sec (V4-Flash想定) | タイムスタンプ測定 |
| Coordinatorメモリ使用量 | < 2GB (int8) | performance.memory |
| Expert Workerメモリ使用量 | < 200MB (int4×8) | performance.memory |
| 通信レイテンシ (1層) | < 50ms (Relay) | EDPタイムスタンプ |
| Speculative Dispatch的中率 | > 70% | Router出力の一致率 |

---

## 11. 参考文献

### 論文 (全10件)

| # | 論文 | 会議 | 年 | テーマ | flaxia関連度 |
|---|------|------|----|--------|-------------|
| 1 | DeepSeek-V4 Technical Report | arXiv | 2026 | V4アーキテクチャ詳細 | ★★★★★ |
| 2 | Prism: Accelerating Edge Inference for Distributed MoE | arXiv:2508.12851 | 2026 | エッジMoE配置最適化 | ★★★★☆ |
| 3 | Speculative MoE: Communication Efficient Parallel MoE | ICML 2025 | 2025 | 投機的Expert通信 | ★★★★☆ |
| 4 | Semantic Parallelism: Redefining Efficient MoE Inference | ICLR 2026 | 2026 | 協調活性化配置 | ★★★☆☆ |
| 5 | Petals: Collaborative Inference of Large Models | NeurIPS 2023 | 2023 | P2P分散推論基盤 | ★★★☆☆ |
| 6 | MoBiLE: Efficient MoE on Consumer GPU | ASP-DAC 2026 | 2026 | 動的Expert削減 | ★★★☆☆ |
| 7 | VELA: Communication-Efficient MoE Fine-Tuning | ICDCS 2025 | 2025 | Expert局所性分析 | ★★☆☆☆ |
| 8 | MoE-Infinity: Offloading-Aware MoE | arXiv 2401.04561 | 2024 | 動的Expert管理 | ★★☆☆☆ |
| 9 | Lynx: Batch-Level Expert Remapping | arXiv | 2025 | バッチ単位再配置 | ★★☆☆☆ |
| 10 | Survey: Optimization Techniques for MoE | arXiv:2412.14219 | 2024 | MoE最適化総覽 | ★★☆☆☆ |

### 技術リファレンス

- HuggingFace Transformers v5: WeightConverter / Expert Parallelism
  https://huggingface.co/docs/transformers/v5.0.0/en/model_doc/deepseek_v4
- ONNX Runtime: MoE contrib ops
  https://github.com/microsoft/onnxruntime/blob/main/docs/ContribOperators.md
- WebRTC DataChannel SCTP parameters
  https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel
- Cloudflare Workers WebSocket
  https://developers.cloudflare.com/workers/runtime-apis/websockets/

### コードリファレンス

- DeepSeek-V4 公式推論コード: https://github.com/deepseek-ai/DeepSeek-V4
- Mini-3Bテストモデル: https://huggingface.co/kshitijthakkar/deepseek-v4-mini-3B-init
- テストモデル実装コード: `kshitijthakkar/deepseek-v4-mini-3B-init/tree/main/code`

---

## 付録A: 用語集

| 用語 | 定義 |
|------|------|
| **Coordinator** | 非Expert部 (Embed+Attention+mHC+Router+SharedExpert+OutputHead) を担当するノード |
| **Expert Worker** | 一部のRouted Expert FFNを担当するノード |
| **Routed Expert** | Routerによって選択的に活性化される専門家FFN |
| **Shared Expert** | 全トークンが常に通る共有FFN (Router結果に加算) |
| **Hash-routed MoE** | vocab_idから決定論的にExpertを選択する方式 (最初の2層) |
| **mHC** | Manifold-Constrained Hyper-Connections。Sinkhorn-Knopp反復で4-stream残差混合 |
| **CSA** | Compressed Sparse Attention。圧縮KV + 疎なattention |
| **HCA** | Heavily Compressed Attention。強圧縮KV + dense attention |
| **MTP** | Multi-Token Prediction。複数先トークンの補助予測head |
| **EDP** | Expert Dispatch Protocol。Coordinator-Expert間通信プロトコル |

## 付録B: モデル設定 (JSON)

```json
{
  "architectures": ["DeepseekV4ForCausalLM"],
  "model_type": "deepseek_v4",
  "hidden_size": 3072,
  "num_hidden_layers": 60,
  "num_attention_heads": 24,
  "num_key_value_heads": 1,
  "head_dim": 128,
  "n_routed_experts": 256,
  "n_shared_experts": 1,
  "num_experts_per_tok": 8,
  "num_hash_layers": 2,
  "moe_intermediate_size": 1536,
  "vocab_size": 129280,
  "max_position_embeddings": 1048576,
  "hc_mult": 4,
  "compress_ratios": [0,0,4,112,4,112,...],
  "index_topk": 192,
  "index_heads": 16,
  "index_head_dim": 96,
  "sliding_window": 64
}
```

---

*以上*
