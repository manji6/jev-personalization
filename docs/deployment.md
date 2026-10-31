# 初回Cloudflare配備記録

実施日：2026-10-30（日本時間）。利用者の許可を得て新規リソースを作成し、初回デプロイを実施した。

| 項目                  | 値                                                    |
| --------------------- | ----------------------------------------------------- |
| Worker                | jev-personalization                                   |
| 管理画面              | https://jev-personalization.manji6.workers.dev/admin  |
| SDK                   | https://jev-personalization.manji6.workers.dev/sdk.js |
| health                | https://jev-personalization.manji6.workers.dev/health |
| D1                    | jev-personalization-config                            |
| D1 ID                 | e4fb509d-6ddc-4a45-b03a-bd3900d9a633                  |
| 初回Worker Version ID | 1dc4f49c-4c5d-403f-b662-a34fe1ce07e0                  |

## 実施したこと

- 指定アカウントに同名Worker・D1が存在しないことを確認。
- 新規D1を作成し、0001_config.sqlをリモートへ適用。
- Worker、管理画面、SDK、D1バインディング、共有クォータ用Durable Object、Rate Limiting bindingを配備。
- healthがHTTP 200と`{"ok":true}`、管理画面とSDKがHTTP 200を返すことを確認。
- 初回確認時点のCloudflare Secret一覧は空。管理APIは`503 server_not_configured`を返し、秘密情報なしで設定を操作できないことを確認。

管理APIの503はSecretsの登録前の状態を示す。D1の初期設定ではメタデータ送信と施策配信が無効。公開サイトへのSDK設置や有料Jevリクエストは行っていない。

## 利用者が行う初回設定

CloudflareのWorkers & Pagesからjev-personalizationを開き、Settings → Variables and Secretsで次の2つをSecretとして登録し、変更を保存・デプロイする。

- JEV_API_KEY：利用するJevのキー。
- ADMIN_TOKEN：ランダムな32文字以上の管理画面用パスワード。管理画面へも同じ値を入力する。

CLOUDFLARE_API_TOKENをWorkerのSecretsへ登録する必要はない。キーの値をGitやチャットへ保存しない。登録後、管理画面でサイトと施策を設定する。

## コード更新

実装と運用先の設定はmainへ反映する。今回の配備はWranglerからの直接デプロイであり、GitHubとの自動連携を作成したものではない。CloudflareのBuilds設定でリポジトリとmainブランチを接続すれば、以降はPushから自動デプロイできる。設定値は[Cloudflareセットアップ手順](cloudflare.md)を参照。

## 2026-10-30：JevSense・オファー表示機能の更新

- サービス名をJevSense（ジェブセンス）に統一。既存のURL、タグ、JevPersonalization API名は維持。
- サイト共通デザイン、標準3形式、独自JavaScript、表示対象ページ、説明付きの管理フォームと共通プレビューを配備。
- Worker Version ID：5ed5b60b-ed45-4356-8f9a-fc7038a9d0e3。
- DBマイグレーションは追加なし。配備前後でapp_configのbody・revisionが一致し、既存設定を変更していないことを確認。
- ADMIN_TOKEN、JEV_API_KEYのSecret名を確認し、両方維持されていることを確認。値は取得していない。
- health・管理画面・SDK・描画モジュール・許可Originからのサイト設定取得はHTTP 200。未認証の管理APIは401。
- 自動テスト49件、Wrangler dry-run、依存監査を実施。実サイトの履歴を使った有料Jev要求は送っていない。

更新確認時は管理画面を再読込し、サイト側もSDKキャッシュ（最大5分）に注意して再読込する。既存施策に表示形式がない場合はフローティング形式を既定として補完し、サイト共通デザインは初期値を使う。デザインや形式の変更は利用者が管理画面から保存する。

## 2026-10-30：SDKの初回判定・イベント起点の通信へ変更

- Worker Version ID：45e12b1b-1c8b-4a39-b06b-d475bdf038c6。
- 15秒ごとの判断要求を廃止し、初回のサイト設定取得後は即時要求。以降は最低表示時間への到達、ページ遷移、許可された操作・状態やページメタデータの変化で要求する。
- 最低表示時間はNode・Workers双方の公開サイト設定APIから取得。同じ状態の重複要求を抑止し、通信中の変更は最新状態へまとめる。
- 非表示中の表示応答は保持し、状態が変わらなければ再表示時に通信せず描画する。表示中のオファーがある間は追加要求を止める。
- 自動テスト60件（単体・HTTP・DOM 27、workerd 7、Chromium 26）が成功。長時間の通信抑止は仮想時計で確認。有料Jev要求は追加していない。
- 配備前後のD1設定body・revisionが一致。追加DBマイグレーションなし。
- 公開health・管理画面・SDK・許可Originからのサイト設定取得を確認し、公開SDKがテスト済みビルドとバイト単位で一致することを確認。

既存のタグは変更不要。開いたままのページには旧SDKが残るため、対象サイトを再読込する。通常のSDKキャッシュは最大5分で、すぐに確認する場合は開発者ツールでキャッシュを無効にして再読込する。

## 2026-10-30：管理画面から起動するデバッグパネル

- Worker Version ID：df5b6556-9242-439a-ab35-0e279eb4149b。
- 管理画面に「実サイトで動作確認」を追加。SDKのパネルで計測情報・送信内容・APIの前処理・Jevの質問と回答・描画結果を確認できる。
- 15分間・サイトID・Origin限定の署名付き診断認可を実装。管理トークンやJevのキーを実サイトへ渡さず、URLやブラウザストレージへ診断認可を保存しない。
- 診断の記録はタブのメモリ内のみ。追加のJev要求・同意の迂回・サーバーへの閲覧履歴保存は行わない。
- 自動テスト73件（単体・HTTP・DOM 32、workerd 8、Chromium 33）を確認し、書式チェックとWrangler dry-runも成功。有料Jev要求は追加していない。
- 新しいSecret・DB・マイグレーションは不要。配備前後のD1設定body・revisionが一致することを確認。
- 公開health・管理画面を確認。公開SDK・管理JavaScriptはテスト済みビルドとバイト単位で一致。未認証の診断認可発行は401。
- Adobe検証サイトのHEAD応答は200で、確認時点にCross-Origin-Opener-Policyヘッダーはなし。実サイト上で管理認証した診断操作は自動実施していない。

管理画面と対象サイトを再読込して利用する。起動方法と記録範囲は[診断マニュアル](debugging.md)を参照。

## 2026-10-31：管理画面v2の検討・モック（ローカル確認）

- [認証・サイト所属・Superuser・画面構造の設計案](admin-v2-plan.md)と[操作モックHTML](prototypes/admin-v2.html)を作成。手動共有の招待を初期方式とし、将来のメール配送と分離。
- 当初は別URLのレビュー経路を用意したが、利用者の「Cloudflareへ公開せず確認したい」という希望を受け、本番のルート・Asset・Dockerへの追加は取り下げた。最終形は単独HTMLと127.0.0.1だけで動くローカル確認サーバー。既存の管理画面・認証は維持。
- 公開ルート案の段階で自動テスト82件（単体・HTTP・DOM 33、workerd 8、Chromium 41）、書式チェック、Wrangler dry-runが成功。ローカル確認へ変更後の検証記録はvalidation.mdを参照。
- 別の隔離実験でSimpleWebAuthn 14.0.3とworkerdのES256登録・署名検証など6項目を観測。本番のユーザーDB・パスキー認証・招待・セッション・復旧・DB移行は未実装。
- 公開用のCloudflare APIはD1要求に10000 Authentication error、トークン検証APIにHTTP 401 / Invalid API Tokenを返した。環境の設定観測はreadyだが、実際のCloudflare認証が成功することを示さない。
- 配備コマンドはD1マイグレーションの確認段階で停止し、Assetアップロードには進んでいない。新しい公開Version IDはない。既存DBの内容比較も認証エラーで実施できず、比較済みとは扱わない。
- トークン値は表示・記録していない。現行の公開環境やSecretsを変更する操作、新規リソースの作成は行っていない。

Web上のレビューURLは追加しない。単独HTMLをダウンロードしてブラウザで開くか、npm run preview:adminで手元の127.0.0.1へ表示する。新たなCloudflareトークンの準備はモック確認には不要。設計書の画面例からもレビューできる。

ローカル確認への変更後、公開先の/admin-previewがHTTP 404であることを読み取り確認した。本番用のNode・Workers・Assetビルド・Dockerのコードはモック追加前へ戻し、モック表示は単独HTMLとローカル専用スクリプトだけにした。
