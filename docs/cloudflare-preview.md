# Previewで確認してからProductionへリリース

本番と同じWorker配下のCloudflare **Worker Previews**を使用します。従来のVersion URLを単に有効にして本番DBへ接続する方式ではありません。

## ブラウザで確認する

確認用管理画面：**https://admin-v2-jev-personalization.manji6.workers.dev/admin**

パスキーの登録先を固定するため、この固定Preview URLを使ってください。Cloudflare画面に表示される個別Deployment URLを管理画面の入口には使いません。

1. Cloudflare Accessの画面で、許可されたCloudflareアカウント所有者のメールを入力します。届いたコードで入場します。これはJevSenseへ入る前の入場制限です。
2. JevSenseの初回画面で表示名を入力し、端末のパスキーを登録します。メールはAccessで認証した本人のアドレスに固定します。確認環境では初回管理トークンの入力は不要です。
3. 以後のJevSenseログインはパスキーです。Accessの期限が切れた場合だけ、入口でも再度認証します。
4. 画面上部の**PREVIEW**表示と確認版のコミットを確認します。作成・停止・共通デザイン等の操作は確認用DBへ保存します。

確認用サイトは`preview-demo`、実ページ確認のURLは **https://admin-v2-jev-personalization.manji6.workers.dev/demo** です。施策の表示対象を全許可ページ、または完全一致`/demo`にして、一覧のプレビューから開きます。実際のAdobeサイトでの計測と、このサンプルページでのテストを混ぜません。Accessで全体を保護したPreviewへ、外部サイトのSDKから認証Cookieなしで通信することはできません。現在の確認はこの同一Originのデモページで行い、実サイトの既存タグの接続先は変更しません。外部サイトとの接続確認を追加する場合は、管理画面と配信APIの保護範囲を別途設計します。

現在の確認環境のJev判断は固定のテスト値0.95です。実Jevを呼ばず、実測値や精度検証の結果として扱いません。パスキー・DB保存・サイト権限・描画・1回限りの確認表示は実処理です。実モデルを確認する場合は、確認環境用Secretと費用上限を別に設定して`PREVIEW_MODEL_MODE`を変更します。

## 分離しているもの

| 対象                    | Production                           | Preview                                 |
| ----------------------- | ------------------------------------ | --------------------------------------- |
| Worker配信              | 現行Production                       | 名前`admin-v2`のWorker Preview          |
| D1                      | jev-personalization-config           | jevsense-admin-v2-preview               |
| D1 ID                   | e4fb509d-6ddc-4a45-b03a-bd3900d9a633 | fdf93bda-2c2b-4df9-bde8-e13f20b6852e    |
| 管理アカウント/パスキー | 本番DBと本番Origin                   | 確認DBと確認Origin                      |
| Durable Objects         | 本番の名前空間                       | CloudflareがPreview専用の名前空間を作成 |
| IP制限                  | namespace 1001                       | namespace 1002                          |
| 認証Secret              | 本番の値                             | Preview専用AUTH_SECRET                  |
| Jev                     | 本番キーで実行                       | 現在はスタブで実Jevなし                 |
| Access                  | 本番は今回の保護対象に含めない       | このWorkerの全Previewを保護             |

確認用アカウント・施策・履歴を本番へコピーしません。本番の初回パスキー登録は本番Originで別途行います。

## Accessの設定は何をするものか

APIトークンへ追加するAccess権限は、こちらの作業環境から入場制限を作るための**操作権限**です。利用者が入力するメールコードやJevSenseのパスキーとは別です。

今回作成したAccess applicationは`JevSense Preview (account owner)`。対象は`preview_worker`で、このWorkerのPreviewだけです。許可は既存のCloudflareアカウント所有者のメール1件、Accessセッションは12時間です。Zero TrustのAccess Applicationsから対象メールを変更できます。ほかの人へ確認を依頼する場合は、JevSenseの招待に加え、Access側でもその人を許可してください。

Worker側でもAccessのJWTについて発行元・audience・署名・期限を検証します。単にヘッダー名が存在するだけでは入場できません。Accessの設定が不完全なときも画面を返しません。

## 次の変更をPreviewへ反映する

実装をコミットし、作業ツリーが空であることを確認して実行します。

```sh
npm ci
npm run check
npm run test:cloudflare
npm run test:browser
npm run cf:preview
```

`cf:preview`は次を実行します。

1. Productionと異なるDB・費用カウンター・認証設定であることを検証。
2. ビルドし、`wrangler.preview-migrations.json`のPREVIEW_DBだけへ移行を適用。
3. 新規DBのサンプル初期状態にだけ確認用サイトを登録。既存の確認用設定を上書きしない。
4. `wrangler preview --name admin-v2 --ignore-base-config`で確認版を配置。既存の共有Previews Baseにある変数やキーを無断で引き継がない。
5. 配置したコミットとDeployment ID、Production設定のハッシュを`data/deployments/preview.json`へ記録。

固定URLは同じですが、中身が新しい版になります。確認版のコミット表示を見てからレビューしてください。現在は1つの確認環境を順番に使う運用です。複数ブランチを同時に確認したい場合は、Preview名・Origin・D1・移行設定をそれぞれ分けます。

AUTH_SECRETは初回配置時にPreview Secretとして設定済みで、更新時はCloudflare側の値を保持します。値を設定ファイルやGitへ追加しません。デプロイ記録のファイルもGit対象外です。作業環境を作り直して記録がなくなった場合は、同じコミットをPreviewへ再配置し、記録と確認を作り直します。

## 確認後にProductionへリリースする

**利用者の確認が終わり、そのコミットの本番反映が明示的に許可された後**に実行します。今回の作業では実行しません。

```sh
npm run cf:release -- --reviewed-commit FULL_40_CHARACTER_COMMIT_SHA
```

以下を満たさないと本番の変更処理へ進みません。

- 現在のHEADが指定した確認済みコミットと完全一致する。
- 未コミットの変更がない。
- 配置記録が同じコミットを示し、未コミット版のPreviewではない。
- Preview配置時からProductionの構成を変更していない。
- ProductionとPreviewでDBを共有していない。
- 本番のJEV_API_KEY・初回登録用ADMIN_TOKENがSecretとして存在する。

本番のAUTH_SECRETがまだない場合は、本番リリースの操作内で新しい独立した値を生成し、Secretとして登録します。Previewの値はコピーしません。その後に本番DBの追加移行とコード配備を行います。確認用D1のユーザーや施策は本番に入りません。

`cf:deploy`も同じ確認を要求します。引数なしの実行、GitHubへのPush、CIの成功だけでは本番リリースしません。Cloudflare Buildsに以前の自動デプロイコマンドを残している場合、確認済み記録のない自動実行は停止します。Previewは`npm run cf:preview`、Productionは上の明示的なリリースコマンドという運用に統一してください。

本番への初回切り替え・バックアップ・ロールバックは[管理画面移行手順](admin-v2-setup.md)を併せて確認します。旧版バイナリへコードだけを戻してDBを放置するロールバックは行いません。

## 本番を変えないための確認

Previewの前後でProductionのDeployment IDとversionを照合します。今回準備時の本番versionは`df5b6556-9242-439a-ab35-0e279eb4149b`です。Preview用のURLルーティングと保護設定を有効にしても、本番コードへ切り替える操作は行いません。

参考：[Cloudflare Worker Previews](https://developers.cloudflare.com/workers/previews/) / [リソース分離](https://developers.cloudflare.com/workers/previews/resources/) / [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

## 検証記録

2026-11-01（日本時間）、125件の自動テスト（Node/API46件、workerd13件、ブラウザ66件）が成功しました。Accessの署名・期限・対象アプリ、別DBと移行先の一致、本番リリースのコミット制限、同一Originの確認ページだけでAccess Cookieを送ることを検証済みです。公開URLの未ログインアクセスがAccessのメールコード画面へ進むこと、Productionのversionが変わっていないことも照合します。実際の本人のメールコード入力・実機パスキー登録は利用者による最終確認です。

アカウント用APIトークンの認証確認には`wrangler whoami`またはアカウント用の検証APIを使います。ユーザー用`/user/tokens/verify`の401だけで、アカウント用トークンを無効と判定しません。
