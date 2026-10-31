# 最初に読む・ローカルで体験する

## 管理画面へ招待された方

インストールは不要です。招待リンクを開いて、表示名とパスキーを登録します。[ログイン・アカウント](../guides/accounts)へ進んでください。

## 自分で導入する方

Cloudflare運用を推奨する構成として用意しています。まずローカルで画面を試し、[Cloudflareセットアップ](./cloudflare)で自分の環境へ導入すると流れがわかりやすくなります。

## ローカル確認の前提

- Node.js 24以上とnpm
- Git
- パスキーに対応したブラウザと端末。最初はChromeまたはEdgeで確認してください。

現行v2の確認対象ブランチを取得します。

```sh
git clone --branch feature/admin-v2-implementation https://github.com/manji6/jev-personalization.git
cd jev-personalization
npm ci
npm run review
```

## 登録する

**`http://localhost:4174/admin`** を開きます。`127.0.0.1`ではなく、このlocalhostの表記を使います。

表示名・メール・以下のローカル専用トークンを入力し、パスキーを登録します。

```text
local-review-only-not-a-production-token
```

::: warning 本番では使わない値です
これは公開されている確認用の値です。本番のADMIN_TOKENには、秘密管理サービス等で作った独立したランダムな値を設定してください。
:::

## どこまで実際に動くか

パスキー認証、DBへの保存、サイト権限、施策編集、オファー表示は実処理です。Jev判定だけを`local-review-stub`、判定値0.95のスタブにしています。JevやCloudflareへ接続せず、公開も行いません。

確認用サイトは登録済みです。施策を作り、実ページプレビューのURLに **`http://localhost:4174/demo`** を指定してください。対象パスは全許可ページまたは`/demo`にします。

## 再起動・終了

Ctrl+Cで終了します。アカウントと設定は`data/review.sqlite`に残り、再起動後も使えます。履歴が必要ならこのDBを消さないでください。

初期状態から試す場合はサーバーを停止し、別の新規DBを`REVIEW_DB_PATH`へ指定します。ポートを変える場合は`REVIEW_PORT`も指定できます。

パスキーはOriginとRP IDに結び付きます。確認途中でlocalhostを別ドメインやIPへ変えないでください。
