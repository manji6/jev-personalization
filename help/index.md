---
layout: home
title: はじめに
hero:
  name: JevSense
  text: その人の、いまを。<br>ちょうどいいご案内に。
  tagline: 閲覧の文脈を察知・判定して、用意したコンテンツを届ける。導入する人も、施策をつくる人も、ここから始められます。
  image:
    src: /favicon.svg
    alt: JevSense
  actions:
    - theme: brand
      text: はじめて使う
      link: /getting-started/quickstart
    - theme: alt
      text: 施策の作り方を読む
      link: /guides/campaigns
features:
  - title: 言葉で、判断したいことを設定
    details: 伝える内容と、対象者の関心・状態を入力。実際に使うYes/Noの質問を確認できます。
    link: /guides/campaigns
  - title: サイト共通タグで観測
    details: 閲覧順序・表示時間・ページ情報を自動取得。応募・予約・カート等の状態は必要なときだけ追加します。
    link: /integration/sdk
  - title: サイトに合う表示を用意
    details: モーダル・フローティング・通知バーと共通デザイン。独自JavaScriptにも対応します。
    link: /guides/presentation
  - title: 安全に確認してから配信
    details: 下書き・1回限りの実ページプレビュー・診断パネル。環境の更新もPreviewから本番へ進めます。
    link: /guides/testing
---

::: info このヘルプの対象
パスキー対応の管理画面v2を対象にしています。v2は本番反映前の確認段階を含みます。管理トークンで設定を読み込む旧画面をお使いの場合は、[旧版マニュアル](https://github.com/manji6/jev-personalization/blob/main/docs/manual.md)も確認してください。
:::

## 目的から探す

| やりたいこと                       | 読むページ                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------- |
| まず何ができるのか知りたい         | [JevSenseとは](./introduction/overview)                                     |
| 招待されて施策を作りたい           | [ログイン・アカウント](./guides/accounts)、[施策を作成](./guides/campaigns) |
| 自分の環境にインストールしたい     | [Cloudflareセットアップ](./getting-started/cloudflare)                      |
| ページに表示されない理由を調べたい | [診断パネル](./guides/debugging)、[トラブル対応](./troubleshooting)         |
| Previewを見てから本番へ反映したい  | [PreviewからProductionへ](./getting-started/preview-production)             |

![管理画面のホーム](/images/home.png)
