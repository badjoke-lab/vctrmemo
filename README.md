# vctrmemo v0.4 — WebXDC Mini App 試作版

Vector上で開く、ローカル優先のメモ・タスク管理アプリです。Notion相当の製品ではありません。


## v0.4（ページ階層・データベース機能）

- ページの「＋ 子ページ」で階層ページを作成。親ページセレクターから階層を変更できます（循環参照は選択不可）。
- データベースは「＋ 列を追加」で text / number / date / checkbox のカスタム列を追加できます。列を非表示にしても変更履歴は残ります。
- 「絞り込み」で任意項目に文字列が含まれるタスクのみ表示。「並び替え」で指定列の昇順・降順を選択できます。フィルター・並び替えはカンバンにも適用されます。
- v0.3からの変更履歴（sync.version = 2）を維持したまま拡張。追加列およびページ階層の更新も、Vector内での**手動共有**対象です。
- v0.4は本格的な共同編集・自動同期・端末内暗号化を提供しません。機密情報の入力は避けてください。WebXDC実機間での配信は未検証です。

## 使い方

1. `vctrmemo.xdc` をVectorのチャットに送って、Mini Appとして開きます。Vector実機での起動・端末間配送は**未検証**です。
2. ページ・ブロック・タスクを編集できます。端末保存は自動です。
3. 相手に渡すには「変更を共有」を押して、チャット全参加者への送信に同意してください。同期は**手動**です。
4. 重要な編集を行った後は「エクスポート」でJSONバックアップを保存してください。

## 搭載済み機能

- ページ・ブロック（見出し、テキスト、チェック、引用、コード）
- タスクテーブル、カンバン、期限、優先度、検索
- ローカル保存、JSONバックアップと復元
- 操作履歴によるフィールド単位のマージ、同時変更の競合検出と手動解決
- v0.3: WebXDC送信上限に合わせたUTF-8サイズベースの分割送信
- v0.3: `sendUpdateInterval`を尊重した時間間隔付き送信
- v0.3: 再送時のID重複排除、順不同で届く分割メッセージの統合
- v0.3: 送信途中に失敗した場合の表示と、共有ボタンによる全履歴再送
- v0.2からのローカル保存データ移行は不要（同じ`vctrmemo-v2`キーを利用）

## 重要な制限

- **受信・到達確認はありません。** `sendUpdate`呼び出しが成功しても相手に届いた保証はありません。分割メッセージを途中まで受信した場合も表示が部分的になり得ます。JSONバックアップを併用してください。
- **すべての共有データはチャット参加者に送信**されます。共有前に内容を確認してください。
- WebXDCではチャットごと・送信メッセージごとにMini Appの独立インスタンスが生成されます。既存データが新しい`.xdc`へ自動移行するわけではありません。
- ローカルデータは未暗号化で、アプリ独自の認可・ユーザー管理はありません。機密データを入れないでください。
- Yjs等の文字単位CRDTではありません。同一項目への並行編集は自動で結合せず、両方の候補を保持して選択させます。
- 同期履歴は12,000操作が上限で、圧縮・ガベージコレクションは未実装です。1操作が送信サイズを超える場合は送れません。
- 自動的な差分送信や大容量添付、アクセス権限、リンクDB、表の任意列などNotionの主要機能は未実装です。
- 送信途中でアプリを閉じると残りの送信が中止されます。後で「変更を共有」を押すと全履歴を再送できます。
- v0.1の`workspace-snapshot-v1`は因果順序を保持できないため自動統合しません。旧データを移すときはJSONを利用してください。

## 検証

```sh
node --check app.js
node --check sync-core.js
node --check transfer.js
node tests/test-core.cjs
node tests/test-transfer.cjs
python tests/test-browser.py  # Chromium と Python Playwright がある環境のみ
```

実行済み: 既存同期5シナリオ、分割・再送・順不同・UTF-8サイズの試験、Chromium上の独立2クライアントUI試験（8分割送信、重複・逆順受信、ローカル保存）。**実際のVectorのWebXDC実装でのテストではありません。**

## WebXDC仕様

- https://webxdc.org/docs/spec/sendUpdate.html
- https://webxdc.org/docs/spec/setUpdateListener.html
- https://webxdc.org/docs/spec/messenger.html
- https://webxdc.org/docs/spec/format.html

## GitHub運用（ZIPを手動で再配布しない）

- `main`更新ごとにGitHub ActionsがJavaScript構文、同期単体試験、ブラウザ2端末模擬試験を実行します。
- 成功したときだけ `.xdc` を自動作成し、Actions成果物およびGitHub Pagesの固定ファイル `vctrmemo.xdc` に配置します。
- GitHub Pagesのブラウザ版はページ・タスクの動作確認専用で、Vector同期はできません。ローカル保存はブラウザごとです。端末やブラウザ間で自動同期するわけではありません。
- GitHub Actionsで作った成果物はVectorアプリへの自動インストールではありません。Vector用の `.xdc` は実機確認時だけダウンロードしてチャットへ共有してください。既存Mini Appが自動更新されるわけでもありません。
- 自動公開はGitHub Pagesを有効化した**公開リポジトリ**を想定しています。コードが公開されるので、秘密鍵・個人情報・環境変数は絶対にコミットしないでください。アプリのユーザーデータは公開に含まれません。

### 最初の一度だけ行う設定

1. GitHubで `badjoke-lab/vctrmemo` の空リポジトリを作成します（無料GitHub Pagesを使う場合は公開リポジトリ）。
2. 本リポジトリのファイルを `main` に反映します。
3. `Settings > Pages > Build and deployment > Source` を **GitHub Actions** に設定します。
4. `Actions` の `Test, build and publish vctrmemo` を確認し、緑色になったらPagesのURLでブラウザ確認します。

GitHub Pagesの公開URLは通常 `https://badjoke-lab.github.io/vctrmemo/` です（設定後に発行）。
`.xdc` の固定URLは `https://badjoke-lab.github.io/vctrmemo/vctrmemo.xdc` です（公開後）。

### ローカル確認コマンド

```sh
node tests/test-core.cjs
node tests/test-transfer.cjs
python scripts/build.py
python tests/test-package.py
```
