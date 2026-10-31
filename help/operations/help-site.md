# ヘルプサイトの保守

このヘルプは、リポジトリの`help/`にあるMarkdownをVitePressでビルドし、GitHub Pagesで公開しています。アプリのサーバーやAPIキーを使わない静的サイトです。生成ツールはVitePress 2.0.0-alpha.21を依存ロックで固定しています。更新時はリンク検査とブラウザ確認を行います。

## 編集する

各ページ下部の編集リンクから提案するか、ローカルでMarkdownを編集します。画面例は`help/public/images/`、メニューは`help/.vitepress/config.mts`です。

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

内部リンク切れはビルドでエラーにします。検索、メニュー、コードのコピー、スマートフォン幅も確認してください。

## GitHub Pagesへ公開する

変更をコミットし、作業ツリーを空にしてから実行します。GitHubへのPushとPages設定ができる権限が必要です。

```sh
npm run help:publish
```

ビルド済みファイルだけを`gh-pages`へ、通常の履歴を保ったPushで更新します。初回だけPagesの配信元を`gh-pages`のルートに設定します。既存のPages設定が異なる場合は、無断で置き換えず停止します。

公開先は **https://manji6.github.io/jev-personalization/** です。GitHub側のビルド・配信完了まで少し時間がかかります。

## アプリの本番反映との違い

ヘルプの公開は`gh-pages`だけを更新します。アプリのProductionへコードを配置したり、DBを移行したりしません。

アプリの確認版コミットを変えた場合は、別途Previewへ配置し、確認後にProductionへ進めます。ヘルプを公開したことを、アプリの本番リリース済みという意味には扱いません。
