# Phase 3: 最適化・実用化

## 目的

Phase 2 の分散MoE推論を実用レベルに最適化する。
レイテンシ低減、スループット向上、フォールトトレランスを実現する。

## TODOリスト

### 3.1 WebRTC DataChannel 最適化

- [ ] `packages/node/src/client/WebRTCPeer.ts` の本実装
  - DataChannel 確立
  - メッセージ送受信 (ArrayBuffer 転送)
  - 複数Peer管理 (RTCPeerConnection pool)
- [ ] NAT越え:
  - STUNサーバー設定 (Google Public STUN)
  - TURNサーバー fallback (Cloudflare TURN? または自己ホスト)
- [ ] WebRTC と Cloudflare Relay の自動切り替え:
  - WebRTC接続失敗時 → Relay fallback
  - レイテンシ測定 → 最適経路選択
- [ ] SCTP vs RTCDataChannel パラメータ調整:
  - 順序保証あり (ordered = true) — MoEでは必須
  - メッセージサイズ制限対応 (SCTP max 256KB → 分割)

### 3.2 レイテンシ最適化

- [ ] **トークンバッチ処理**:
  - 複数トークンをまとめてExpertに送信
  - バッチサイズの動的調整 (レイテンシ vs スループットのトレードオフ)
- [ ] **Speculative Expert Dispatch**:
  - 現在の層のRouter出力から次層の活性化Expertを予測
  - 予測に基づいて事前にExpertノードにhidden_statesをプリロード
  - 的中率70%以上を目標
- [ ] **Expert結果のキャッシュ**:
  - 同じトークンが再度同じExpertを通る場合、結果をキャッシュ
  - KV-cache相当のExpert出力キャッシュ
- [ ] **パイプライン並列化**:
  - 層単位のパイプライン: Layer NのExpert計算中にLayer N+1のAttentionを開始
  - Coordinator内のAttentionとExpert計算をオーバーラップ

### 3.3 Expert配置最適化

- [ ] **ホットExpert分析**:
  - 実使用時の各Expertの活性化頻度を計測
  - 頻繁に活性化されるExpert (hot expert) を特定
  - DeepSeek-V3論文の分析結果を参考に
- [ ] **Expert複製 (Replication)**:
  - ホットExpertを複数ノードに複製
  - Coordinatorが最も負荷の低いノードを選択
- [ ] **動的再配置 (Migration)**:
  - 負荷変動に応じてExpertの担当ノードを変更
  - ノード離脱時：Expertを別ノードに再割当
  - セッション中の再配置は最低限に (コスト大)
- [ ] **メモリ使用量の最適化**:
  - Expertの動的ロード/アンロード
  - 使用頻度低いExpertはメモリから破棄し、必要時に再ロード
  - LRUキャッシュ方式

### 3.4 フォールトトレランス

- [ ] **Expertノード障害検出**:
  - Heartbeatタイムアウト (3回連続)
  - WebSocket切断検知
  - Coordinatorからの推論タイムアウト検知
- [ ] **グレースフルデグラデーション**:
  - 1-2 Expertダウン: 残りのExpertだけで推論継続（品質低下許容）
  - Top-8中2つ欠落 → Top-6で代用
  - 品質低下をユーザーに通知
- [ ] **Coordinator障害対策**:
  - Coordinatorの状態を定期的にCloudflare Workerにバックアップ
  - Coordinatorダウン時: 別ノードをCoordinatorに昇格
  - 昇格にはAttention重みの転送が必要（大きい→要検討）
- [ ] **チェックポイント/リストア**:
  - 推論途中のKV-cache状態を定期的にバックアップ
  - 障害発生時: 最新のチェックポイントから再開

### 3.5 帯域幅最適化

- [ ] **量子化転送**:
  - hidden_states を転送時に量子化 (fp16 → int8)
  - 誤差を許容できるか検証
- [ ] **差分転送 (Delta Transfer)**:
  - 前層からの差分のみを転送（変化が小さい場合に有効）
  - Attention出力の変化量を監視
- [ ] **圧縮**:
  - zstd/lz4 によるペイロード圧縮
  - 隠れ状態はランダムに近いため圧縮率は低い → 実測要
- [ ] **SharedArrayBuffer 活用**:
  - WebRTC経由で SharedArrayBuffer を共有
  - CoordinatorとExpertが同じメモリを参照（同一タブ内で有効）

### 3.6 モニタリング・プロファイリング

- [ ] **パフォーマンスメトリクス収集**:
  - 各層のAttention時間
  - 各ExpertのFFN計算時間
  - ネットワーク転送時間 (送信・受信)
  - ボトルネックExpertの特定
- [ ] **ダッシュボード**:
  - Coordinator / Expert / Relay それぞれのダッシュボード
  - リアルタイム Expert 活性化マップ
  - レイテンシ分布表示
- [ ] **プロファイリング出力**:
  - 推論終了時にJSONで性能レポート出力
  - 自動回帰テストに組み込み

### 3.7 セキュリティ

- [ ] **Expertモデルの完全性検証**:
  - モデルハッシュ検証 (SHA-256)
  - Coordinatorが期待するExpert重みと一致するか確認
- [ ] **悪意あるExpertノード対策**:
  - 結果の整合性チェック（複数ノードに同じ計算を依頼し比較）
  - 異常値検出（出力が統計的に大きく外れたExpertをマーク）
  - 評判システム (reputation score)
- [ ] **プライバシー**:
  - 入力テキストはCoordinatorのみが保持
  - Expertノードには隠れ状態のみが渡る（原文復元困難）
  - データフロー図の文書化

### 3.8 長期的課題

- [ ] **トレーニング連携**:
  - flaxia-crowd上での分散MoEファインチューニング
  - 各Expertノードが勾配を計算 → Coordinatorが集約
- [ ] **より大規模モデル対応**:
  - 70B-A7Bクラス (Llama 4 Scout相当)
  - Attention層も分散 (Multi-head Attention の分散)
- [ ] **標準化**:
  - 他プロジェクトとの相互運用

### 成果物

- [ ] WebRTC P2P通信の本実装
- [ ] Speculative Dispatch ロジック
- [ ] Expert複製・動的再配置機構
- [ ] フォールトトレランス機構
- [ ] モニタリングダッシュボード
- [ ] セキュリティ監査レポート
