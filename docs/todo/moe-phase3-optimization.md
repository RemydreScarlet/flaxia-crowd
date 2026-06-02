# Phase 3: 最適化・実用化

## 目的

Phase 2 の分散MoE推論を実用レベルに最適化する。
レイテンシ低減、スループット向上、フォールトトレランスを実現する。

## TODOリスト

### 3.1 WebRTC DataChannel 最適化
- [ ] `packages/node/src/client/WebRTCPeer.ts` の本実装
  - DataChannel 確立・複数Peer管理
  - メッセージ送受信 (ArrayBuffer 転送)
- [ ] NAT越え: STUN/TURN設定
- [ ] WebRTC と Cloudflare Relay の自動切り替え
- [ ] SCTPパラメータ調整 (ordered=true, メッセージ分割)

### 3.2 レイテンシ最適化
- [ ] **トークンバッチ処理**: 複数トークンをまとめてExpertに送信
- [ ] **Speculative Expert Dispatch**:
  - 現在の層のRouter出力から次層の活性化Expertを予測
  - V4-Flashの256 Expertのうちtop-7を予測
  - 的中率70%以上を目標
- [ ] **Expert結果のキャッシュ**: 同一トークンの再計算回避
- [ ] **パイプライン並列化**: Attention計算とExpert計算のオーバーラップ

### 3.3 Expert配置最適化
- [ ] **ホットExpert分析**: 活性化頻度計測・可視化
- [ ] **Expert複製**: ホットExpertを複数ノードに複製
- [ ] **動的再配置**: 負荷変動に応じて担当ノード変更
- [ ] **メモリ最適化**: Expert動的ロード/アンロード (LRU)

### 3.4 フォールトトレランス
- [ ] Expertノード障害検出 (Heartbeat/Timeout)
- [ ] グレースフルデグラデーション (top-7中欠落 → top-6で代用)
- [ ] Coordinator障害対策 (状態バックアップ・昇格)
- [ ] チェックポイント/リストア

### 3.5 帯域幅最適化
- [ ] **量子化転送**: hidden_states fp16 → int8
- [ ] **差分転送**: 前層からの差分のみ転送
- [ ] **圧縮**: zstd/lz4 ペイロード圧縮（効果測定）
- [ ] **SharedArrayBuffer**: 同一タブ内のメモリ共有

### 3.6 モニタリング・プロファイリング
- [ ] パフォーマンスメトリクス収集 (Attention/FFN/通信時間)
- [ ] ダッシュボード (リアルタイムExpert活性化マップ)
- [ ] プロファイリング出力 (JSONレポート)

### 3.7 セキュリティ
- [ ] Expertモデルの完全性検証 (SHA-256)
- [ ] 悪意あるExpertノード対策 (結果整合性チェック)
- [ ] プライバシー (入力テキストはCoordinatorのみ保持)

### 3.8 長期的課題
- [ ] 分散MoEファインチューニング
- [ ] より大規模モデル対応 (V4-Pro: 1.6T)
- [ ] 標準化・相互運用

### 成果物
- [ ] WebRTC P2P通信の本実装
- [ ] Speculative Dispatch ロジック
- [ ] Expert複製・動的再配置機構
- [ ] フォールトトレランス機構
- [ ] モニタリングダッシュボード
