# ヘルプサイトの保守

このヘルプはリポジトリの`help/`にあるMarkdownをVitePressでビルドし、GitHub Pagesで公開しています。アプリのサーバーやAPIキーを使わない静的サイトです。生成ツールはVitePress 2.0.0-alpha.21を依存ロックで固定しています。更新時はリンク検査とブラウザ確認を行います。

## 編集する

各ページ下部の編集リンクから提案するか、ローカルでMarkdownを編集します。画面例は`help/public/images/`、メニューは`help/.vitepress/config.mts`です。

日本語のページは`help/`直下、英語のページは`help/en/`に同じファイル名で置いています。ページを変更するときは両方を更新してください。画面例は両言語で共通で、日本語の画面です。管理画面は現在日本語のみのため、英語ページでは画面上の名称を「英訳（「日本語の表示」）」の形で示します。

```sh
npm ci
npm run help:dev
```

ローカルに表示されるURLをブラウザで開きます。開発サーバーは127.0.0.1に限定します。

## ビルドして確認する

```sh
npm run help:build
npm run help:preview
```

内部リンク切れはビルドでエラーにします。検索、メニュー、コードのコピー、スマートフォン幅も、日本語・英語の両方で確認してください。

## GitHub Pagesへ公開する

変更をコミットし、作業ツリーを空にしてから実行します。GitHubへのPushとPages設定ができる権限が必要です。

```sh
npm run help:publish
```

ビルド済みファイルだけを`gh-pages`へ、通常の履歴を保ったPushで更新します。初回だけPagesの配信元を`gh-pages`のルートに設定します。既存のPages設定が異なる場合は、無断で置き換えず停止します。

公開先は **https://manji6.github.io/jev-personalization/** で、英語版は **https://manji6.github.io/jev-personalization/en/** です。GitHub側のビルド・配信完了まで少し時間がかかります。

### 初回有効化だけ403になる場合

GitHubの接続にPages設定の編集権限がない場合、ファイルのPushは成功しても初回有効化だけ失敗することがあります。リポジトリ管理者が[Settings → Pages](https://github.com/manji6/jev-personalization/settings/pages)を開き、Sourceに「Deploy from a branch」、Branchに「gh-pages」、フォルダーに「/ (root)」を選んでSaveします。APIキーや追加トークンを本文へ貼る必要はありません。

一度配信元を設定すれば、以後は`gh-pages`へのPushでヘルプを更新できます。Pages設定APIを使わず公開ファイルだけ更新する場合は`npm run help:publish -- --files-only`を使います。公開URLで表示を確認してから公開完了と扱ってください。

## アプリの本番反映との違い

ヘルプの公開は`gh-pages`だけを更新します。アプリのProductionへコードを配置したり、DBを移行したりしません。

アプリの確認版コミットを変えた場合は、別途Previewへ配置し、確認後にProductionへ進めます。ヘルプを公開したことを、アプリの本番リリース済みという意味には扱いません。
