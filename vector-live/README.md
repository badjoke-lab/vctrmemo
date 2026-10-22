# Vector内の本人2端末リアルタイム通信 — 独立診断実験

**状態: 実験用 / 未実機確認 / メモの自動同期ではありません。**

目的は、**Vector本体を一切改修せず**、公式WebXDCの `joinRealtimeChannel()` を使い、同じVectorアカウントで利用するスマホ・PC間にリアルタイムの通信路ができるかだけを確認することです。

## 何を作ったか

- `vector-live/probe-core.mjs` — 256bitランダムの一時鍵、HKDF→AES-GCMで暗号化した合成ping/ack。チャット参加者宛ての可能性があるため、**メモ本文やワークスペース履歴は絶対に送らない**。
- `vector-live/probe-ui.mjs` — Mini App画面に診断UIを追加。一時鍵を作成し、自分のもう1台へ入力、接続後に通信テスト。キーはlocalStorageに保存しない。
- `scripts/build-vector-owner-probe.py` — 通常版とは異なるパッケージ名・別アプリハッシュの `vctrmemo-owner-realtime-test.xdc` を生成。**公開v0.12と既存データに変更を加えません。**
- CI `vector-owner-probe.yml` — WebXDC通信APIの模擬受信と暗号化・本人識別子・異なる鍵の拒否を検証し、診断XDCをActions成果物として保存。

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
