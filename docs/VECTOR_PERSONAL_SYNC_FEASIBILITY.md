# Vector実装監査 — 本人1アカウント・複数端末同期

**結論（2026-10-22、Vector公式ソース `20efc172693c3556a7d9b61715effc306536f46a`）: 既存のMini AppホストAPIでは、自動・本人専用同期を実装するための条件が揃っていない。**

これは静的ソース監査であり、Vector実機通信の成功や失敗を実測したものではない。今後Vectorの実装が変われば再監査する。

## 実際に確認できたこと

| 観点 | 公式実装上の状態 | vctrmemoへの影響 |
| --- | --- | --- |
| Desktopの `miniapp_get_updates` | `Ok("[]")` 固定、TODOの仮実装 | WebXDC履歴再生に依存できない |
| Desktopの `miniapp_send_update` | TODO「保存して参加者へ配信」 | 呼び出し成功だけでは相手へ届かない |
| Androidの `sendUpdateNative` | 保存・配信はTODO | Android→PC同期に使えない |
| Androidの `getUpdatesNative` | TODO、常に `"[]"` | Android側の履歴復元に使えない |
| Mini Appのネットワーク | ホストの隔離環境。一般的な外部HTTP通信不可 | Mini App内からVector SDK/Nostr relaysへ自由に接続する実装はできない |
| ホストの個人専用同期API | 公開WebXDCブリッジに未提供 | chat全参加者宛てAPIを個人専用通信とみなしてはいけない |
| 未登録Mini Appのローカル保存 | アプリファイルの内容ハッシュが保存領域の識別子 | **新しいXDCで保存領域が変わり、以前のlocalStorageを見られない恐れ** |
| Vector Marketplace登録済みアプリ | Marketplace IDに由来する安定した保存パーティション | 単独起動と版更新時の保存継続に有力な選択肢。登録・配布・実機確認は別途必要 |

## ソース（このコミットに固定）

- [Desktop: update送受信（commands.rs L1384-L1440）](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/miniapps/commands.rs#L1384-L1440)
- [Android: send/get updates（miniapp_jni.rs L276-L346）](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/android/miniapp_jni.rs#L276-L346)
- [ローカル保存パーティション（commands.rs L578-L611）](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/miniapps/commands.rs#L578-L611)
- [Marketplace単独起動（commands.rs L1930-L1947）](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/miniapps/commands.rs#L1930-L1947)
- [Mini Apps公式説明（ネットワーク制限とチャット送信）](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/docs/miniapps/README.md)
- [Vector-SDK公式README](https://github.com/VectorPrivacy/Vector-SDK/blob/main/README.md) は独立したRust bot / Nostr接続用ライブラリを説明。Mini App内の本人専用同期を自動で提供するものではない。

## 構成の比較 — 利用者に2人目を要求しない

| 方法 | 今使えるか | 判定 |
| --- | --- | --- |
| 現在のWebXDC `sendUpdate` で同期 | Desktop/Androidとも更新保存・配信がTODO、chat参加者向け設計 | **不採用** |
| Vectorの自分宛てチャットを用いた同期 | 同じアカウントの一人チャットが成立してもMini Appの更新保存・配信が未実装 | **現状では成立未確認** |
| Marketplace登録Mini Appとして単独起動 | 公式実装に単独起動経路がある | **保存継続の候補（同期は別）** |
| ホストの専用本人同期APIを利用 | 現状なし。Vector本体の拡張が必要 | **本命の技術調査対象** |
| Mini App外のVector SDK常駐プロセス | 独立プロセスとしては実装余地あり、Mini Appとの安全な橋渡しがない | **追加前提なしには採用しない** |
| 外部サービスを必須にする | 無料・追加登録不要という方針と衝突する可能性 | **無断導入しない** |

## 推奨する実装順

1. **保存継続の検証を先行。** Vector Marketplaceで `vctrmemo` の安定アプリIDが取得できるか調べ、同じ本人の同一端末でXDC更新前後に作ったページが残るか検査する。登録前はアプリ更新でデータ継続を保証しない。
2. **ホスト能力の確認。** Vectorに本人のみの認証済み変更履歴配信があるか、現行のMini Appブリッジに提供可能か確認する。
3. **成立してから個人同期アダプタを実装。** owner identity、workspace ID、暗号化、デバイス登録・解除、オフライン復旧を明確化する。受信データを本人認証なしに適用しない。
4. **2端末で実機検証。** 同じアカウントのスマホとPCでA→B、B→A、競合、通信断、端末追加と解除を検査する。第三者に届かないことも確認する。
5. 複数人共同編集はこれらとは別の仕様・認可境界として開発する。

## ソースを使った再現可能な検査

`node scripts/audit-vector-host.mjs`

このコマンドは上記の固定コミットから対象ソースを**読み取るだけ**で、JSONの判定結果を出す。コードの仮実装が変更されたら非ゼロ終了して再レビューを求める。通信実機テスト、暗号化検査、同期成功証明ではない。

**本PRは調査用の変更のみ。アプリ本体と保存データ、XDCのコードは変更しない。**
