# Vector内の本人2端末リアルタイム通信 — 独立診断実験

**状態: 実験用 / 未実機確認 / メモの自動同期ではありません。**

目的は、**Vector本体を一切改修せず**、公式WebXDCの `joinRealtimeChannel()` を使い、同じVectorアカウントで利用するスマホ・PC間にリアルタイムの通信路ができるかだけを確認することです。

## 起動方法 — VectorのNotesにURLを貼るだけ

Vector v0.4.2以降には **Mini Apps from URLs** が実装されています。.xdcファイルへのHTTPSリンクをチャットメッセージとして送信すると、Mini Appカードとして表示されます。

**固定URL（本PRをmainに取り込んでPagesデプロイした後に有効）**

```text
https://badjoke-lab.github.io/vctrmemo/vctrmemo-owner-realtime-test.xdc
```

**操作:** Vectorの「Notes（自分宛て）」に上記URLを1回貼って送信するだけです。表示されたMini Appカードをタップすると、必要に応じてアプリの取得・起動が行われます。ZIPやGitHub Actions成果物を手動ダウンロードする必要はありません。2端末で診断する際は、両端末で**同じNotesの同一投稿**を開いてください。

URLは**診断アプリ配布用**です。本人用同期鍵やメモ内容は含みません。固定URLで配るのは**通信診断**であって、vctrmemo本番メモの同期ではありません。

根拠: [Vector v0.4.2 release notes](https://github.com/VectorPrivacy/Vector/releases/tag/v0.4.2)、[URLから.xdcを表示する公式実装](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src/js/render/chat/xdc-url.js)。

## 何を作ったか

- `vector-live/probe-core.mjs` — 256bitランダムの一時鍵、HKDF→AES-GCMで暗号化した合成ping/ack。チャット参加者宛ての可能性があるため、**メモ本文やワークスペース履歴は絶対に送らない**。
- `vector-live/probe-ui.mjs` — Mini App画面に診断UIを追加。一時鍵を作成し、自分のもう1台へ入力、接続後に通信テスト。キーはlocalStorageに保存しない。
- `scripts/build-vector-owner-probe.py` — **メモ本体の `app.js`、`sync-core.js`、保存用コードを含めない**独立した最小XDCを生成。通常版と別のパッケージ名・別の保存領域を使用し、**公開v0.12と既存データに変更を加えません。**
- CI `vector-owner-probe.yml` — WebXDC通信APIの模擬受信と暗号化・本人識別子・異なる鍵の拒否を検証し、診断XDCをActions成果物として保存。

## 追加で判明した構造上の制約（2026-10-22）

**Notes to Selfは公式実装に存在します。** `src/main.js` では自分の公開鍵をチャットIDと比較し「Encrypted Notes to Self」と表示します。2人目のアカウントは必要ありません。

ただし、**同じアカウントの2端末間通信と、自動同期の成立は保証されません。** Vector公式の `src-tauri/src/db/miniapps.rs` では、Irohピアの既存広告を読み出す `get_active_peer_advertisements()` が `AND npub != ?2` で**自分と同じ公開鍵のピアを除外**しています。また、広告を `GROUP BY npub` でひとまとめにし、`peer-left` も公開鍵を単位に処理します。同じ本人の異なる端末をそれぞれ独立したピアとして安定管理する設計にはなっていません。

- これらは**再接続・オフライン復旧に関する確定した設計上の制限**です。リアルタイムのping/ack自体が絶対に不可能とまでは断定できませんが、CIモックの成功では突破できません。
- そもそもMini Appホストの `sendUpdate` 保存／配信、`getUpdates` 取得処理はTODOで、オフライン履歴を保存できません。
- 合成ping/ackが実機で成功しても、これだけでNotion型メモの永続的な自動同期へ昇格させることは**禁止**します。
- 既存のVectorを無断改修することはしません。公式ホストが改善されるまで本体内での同期完成を主張せず、ブラウザ実験版PR #6の動作と明確に区別します。
- 公式ソース監査: `node vector-live/tests/audit-vector-owner.mjs`。GitHub Actionsで固定コミットの該当コードを読み取り、JSON結果を成果物にします。
- [根拠: Mini Appピア広告の永続取得・除外条件](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/db/miniapps.rs#L516-L610)
- [根拠: 自分宛てNotesの判定](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src/main.js#L7368-L7378)

## 実機試験の手順（可能な場合に限る）

1. 同じVectorアイデンティティで使用する2端末を用意。2アカウントは不要。
2. 本人だけが参加するチャット（自分宛てチャット）がVectorで利用できるか確認する。**Vectorで自分宛てチャットに同じMini Appメッセージを表示できるかは未検証。**
3. テスト用 `.xdc` を、そのチャットの **1つのMini Appメッセージ**として置き、両端末からその同じメッセージを開く。別々の投稿ではアプリインスタンスが異なる。
4. A端末で「鍵を生成」、B端末へ安全に鍵を移す（チャットには貼り付けない）。両端末で「接続」。
5. A端末で「通信テスト送信」。B端末が受信確認を自動返信し、A端末に「受信確認」を表示できるかを見る。
6. 逆向きの通信も確認。通信失敗の場合は表示メッセージを記録する。

このテストは **同じ `selfAddr` を申告した、同じ一時秘密鍵を持つ2実行環境**の暗号化した接続を確かめるだけで、同じアカウントであることを暗号学的に証明しません。WebXDCの `selfAddr` はMini Appへ渡される文字列です。チャットが本人だけの場所だとMini App内から認証する機能は提供されていません。

## できないこと

- Nostrリレーへ直接接続してオフライン時の変更を保存すること。
- このIroh APIのみで、両端末が同時にオンラインでない期間の変更を自動取得すること。
- チャット参加者のいないMarketplace単独起動モードで他端末を見つけること。公式コードはその場合もチャットID宛てのpeer advertisementを試みるため、空のチャットIDでは発見に成功する根拠がありません。
- 既存vctrmemoの個人ページやデータベースを共有／自動同期すること。セキュリティ上、診断アプリは合成データの送信に限定。
- Vectorアカウントの端末認証・端末失効・完全なE2EE個人同期。継続履歴保存や同一人物の本人認証は別途設計が必要。

## 固定したVector公式実装の根拠

- [Iroh peer advertisement はチャットIDを宛先とする](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/miniapps/commands.rs#L890-L978)
- [joinRealtimeChannel() はリアルタイムgossipのtopicに参加する](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/miniapps/commands.rs#L1479-L1595)
- [peer advertisement の送信先はDMの相手またはCommunity](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/commands/realtime.rs#L40-L78)
- [Mini App権限一覧に任意HTTP/WebSocket接続の許可項目なし](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/miniapps/permissions.rs#L50-L112)
- [WebXDCの通常sendUpdateの送信・保存はTODO](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/miniapps/commands.rs#L1384-L1440)

**受け入れ条件:** Vector実機のスマホとPC、同一アカウントで受信確認が往復すること。CIモックの成功を実機成功に言い換えない。最終製品の自動同期には、さらに変更履歴の継続保存と本人認証を解決する必要があります。
