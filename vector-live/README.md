# Vector Mini App — 自動2端末通信診断 v2

## 操作（鍵入力なし）

VectorのNotes（自分宛て）に次のURLを貼り、同じ投稿をスマホとPCの両方で開きます。それ以外のボタン操作は不要です。

```text
https://badjoke-lab.github.io/vctrmemo/vctrmemo-owner-realtime-auto-v2.xdc
```

Mini App起動時に `window.webxdc.joinRealtimeChannel()` に参加し、合成のランダムな `ping` を繰り返します。別の実行環境が同じ通信先へ参加し、その実行環境から自分の `ping` に対応する `ack` が返ると、**「通信成功：別の実行環境から応答を受信しました。」**と表示されます。自分自身へのループバック応答を成功とみなさないよう、起動ごとにランダムなdeviceIdを使います。

以前の `vctrmemo-owner-realtime-test.xdc` はバージョン違いのローカルキャッシュに残る可能性があるため、**新しいURL**を使用します。既存のURLへ新しいビルドを配置する互換性エイリアスも残します。

## 安全性・限界

- **診断専用アプリです。** `app.js` / `sync-core.js` / `transfer.js` はXDCに含まず、個人メモの本文・DB・保存データ・秘密鍵には触れません。保存領域やGitHub Pagesの既存vctrmemo通常版も変更しません。
- 送るのは自動生成したランダムなチャレンジ（nonce、deviceId）、プロトコル識別子、VectorがMini Appに知らせた**公開アカウント識別子** `selfAddr` のみです。
- v1は手動の一時鍵でAES-GCM暗号化していました。**v2ではゼロ設定にするため、その暗号化を廃止**しています。通信経路上の秘匿性・暗号学的な同一アカウント認証をこの診断プログラムが保証するものではありません。そのため実データは絶対に流しません。
- `selfAddr` はアプリへ渡される公開識別子であり、パケット中の申告値は暗号学的な本人証明ではありません。「成功」は別のアプリ実行環境との合成パケットの往復が成立したという意味だけです。同一人物の別端末である保証ではありません。
- 同じ端末の別ウィンドウでも応答が成立する可能性があります。**実際のスマホ・PC 2端末で試験**して初めて端末間到達を確認できます。
- Vector Irohの公式実装はチャットの話題にひもづきます。**Notes（自分宛て）で同じ1件の.xdc投稿を両端末から開くことが前提**です。Marketplaceの単独起動では接続できるとは言えません。
- Vector公式実装のピア広告再発見処理は自分自身のnpubを除外し、同一npubを端末別に管理しません。したがって2端末の到達は**未検証**であり、成功しない可能性があります。
- 仮に通信が成功してもIrohはリアルタイム経路で、WebXDCの永続保存/再生APIは未完成です。**メモの自動同期、オフライン復旧、端末失効は実装していません。** Vector本体は一切改造しません。
- 5秒ごとに小さな合成パケットを送ります。WebXDC接続に参加するので、Vector本体が表示するTor/Irohのネットワーク確認にも従ってください。

## GitHubでの検証

- `node vector-live/tests/probe.test.mjs` : 接続、異なる実行環境間の往復、ループバック拒否、異なる申告アカウント、メモ内容不送信を模擬テスト。
- `node vector-live/tests/audit-vector-owner.mjs` : 固定されたVector公式ソースから、同一npubの再発見とWebXDC履歴の制限を監査。
- `python scripts/build-vector-owner-probe.py` : 通常版から完全に独立した最小XDCを作成。
- `.github/workflows/ci-deploy.yml` : `dist/site/vctrmemo-owner-realtime-auto-v2.xdc` をビルド・検証してGitHub Pagesへ配布。

固定したVector公式ソースの参考:
- [v0.4.2でのMini Apps from URLs](https://github.com/VectorPrivacy/Vector/releases/tag/v0.4.2)
- [WebXDC URLメッセージレンダラー](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src/js/render/chat/xdc-url.js)
- [ピア広告のsame-npub除外](https://github.com/VectorPrivacy/Vector/blob/20efc172693c3556a7d9b61715effc306536f46a/src-tauri/src/db/miniapps.rs#L516-L610)
