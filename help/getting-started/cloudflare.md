# Cloudflareへのセットアップ

Workersで管理画面・SDK・API、D1で管理データ、Durable ObjectsでJevの費用カウンターを動かします。閲覧者の行動履歴をD1に保存する構成ではありません。

## 用意するもの

| 対象                           | 用途                                                      |
| ------------------------------ | --------------------------------------------------------- |
| Cloudflareアカウント           | Workers・D1・Durable Objects・Access                      |
| GitHubのコードとNode.js 24以上 | ビルドと配備                                              |
| Cloudflare API Token           | アカウントのWorkers更新、D1編集、Accessの設定に必要な権限 |
| Jev APIキー                    | 本番の実判定。Previewをスタブで確認する段階では不要       |
| 安定した管理画面Origin         | パスキーの登録先。HTTPSのworkers.devでも利用可能          |

Accessを新規に使う場合はCloudflare Zero Trustの初期設定も行います。料金・利用可能な機能・上限は自分のプランで確認してください。

## 1. コードを取得する

```sh
git clone --branch feature/admin-v2-implementation https://github.com/manji6/jev-personalization.git
cd jev-personalization
npm ci
```

::: warning リポジトリの設定をそのまま配備しないでください
`wrangler.json`には開発者のWorker・アカウント・DB・Access設定が含まれています。下の項目を自分のものへ置き換えます。DBのIDは秘密情報ではありませんが、他環境のIDを使うと誤った接続先になります。
:::

## 2. 本番と確認用のD1を作る

CloudflareダッシュボードまたはCLIで2つ作ります。

```sh
npx wrangler d1 create YOUR-PRODUCTION-DATABASE
npx wrangler d1 create YOUR-PREVIEW-DATABASE
```

本番用と確認用には異なるDatabase IDを使います。確認用DBのデータを本番へコピーしません。

## 3. Wrangler設定を置き換える

最低限、次を設定します。

| ファイル・場所                                | 設定するもの                                           |
| --------------------------------------------- | ------------------------------------------------------ |
| wrangler.json のaccount_id/name               | 自分のアカウントIDとWorker名                           |
| d1_databases のDB                             | 本番Database ID・名前                                  |
| vars.AUTH_MODE                                | passkey                                                |
| vars.AUTH_ORIGIN                              | 本番管理画面のOrigin。末尾スラッシュなし               |
| previews.vars.AUTH_ORIGIN                     | 固定の確認用URLのOrigin                                |
| previews.vars.DEPLOYMENT_TIER                 | preview                                                |
| previews.vars.PREVIEW_MODEL_MODE              | 最初はstub                                             |
| previews.d1_databases のDB                    | 確認用Database ID・名前                                |
| previews.durable_objects.bindings             | MODEL_BUDGET / ModelBudget。同じWorker内のクラスを使用 |
| previews.ratelimits                           | 本番と異なるnamespace_id                               |
| wrangler.preview-migrations.json のPREVIEW_DB | 上の確認用DBと同じID・名前、同じaccount_id             |

`npm run cf:configure -- <D1 UUID> <Worker名>`は本番側のIDとWorker名だけを更新する補助です。account_id、Origin、Preview、移行用設定は別途編集します。

Preview名は、現在の配備スクリプトでは固定AUTH_ORIGINのホスト名から決めます。例：`review-YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev`なら名前は`review`です。

## 4. PreviewのAccess保護を設定する

既存Workerを使う場合は、そのWorkerの設定画面から進めます。新しいWorkerの親リソースがまだない場合は、先にPreviewを**閉じた状態**で作れます。`PREVIEW_ACCESS_AUD`と`PREVIEW_ACCESS_DOMAIN`を空にしたうえで、次を実行します。Workerは入場設定がないため画面を返しません。

```sh
npm run build:cloudflare
npx wrangler preview --name YOUR-PREVIEW-NAME --ignore-base-config
```

CloudflareのAccess applicationで、自分のWorkerの**Previewだけ**を保護します。許可するメールを限定し、Productionを対象に含めないことを確認します。

アプリケーションのaudienceを`previews.vars.PREVIEW_ACCESS_AUD`、チームの認証ドメイン（`TEAM.cloudflareaccess.com`）を`PREVIEW_ACCESS_DOMAIN`へ設定します。どちらも実際のAccess設定から取得してください。

Worker側もJWTの署名・発行元・audience・期限を検証します。設定がない状態では画面を返しません。既存WorkerでPreview URLが無効な場合はルーティングを有効にしますが、そのために未確認のアプリコードを本番へデプロイしないでください。

## 5. Preview用のSecretを登録する

Preview用AUTH_SECRETは、32文字以上の独立したランダムな値です。通常変数やGitへ保存しません。

初回配置では、ローカルの権限を制限したJSONファイルへAUTH_SECRETだけを設定し、`PREVIEW_SECRETS_FILE`で渡す方法が使えます。たとえばファイル名を、Git対象外の`.dev.vars.preview-secrets.json`にします。値は自分で生成した32文字以上の独立した乱数へ置き換えます。

```json
{
  "AUTH_SECRET": "<自分で生成した秘密の値>"
}
```

```sh
# POSIXシェルでの初回例。先に設定・実装をコミットします
PREVIEW_SECRETS_FILE=.dev.vars.preview-secrets.json npm run cf:preview
```

PowerShellでは`$env:PREVIEW_SECRETS_FILE`にファイルパスを設定して実行します。値をコマンドの引数や通常変数へ書かず、ファイルをGitへ追加しないでください。登録後、不要なローカルのSecretファイルは安全に削除できます。

既存のPreviewへは、対話入力でも登録できます。

```sh
npx wrangler preview secret put AUTH_SECRET --name YOUR-PREVIEW-NAME
```

::: info 共有Baseを自動継承しません
このプロジェクトの`cf:preview`は`--ignore-base-config`を使います。共有Previews Baseにだけ置いたSecretが自動で使われると仮定しないでください。Preview自身のSecretは更新時に保持します。
:::

## 6. Previewへ配備して確認する

設定をコミットし、作業ツリーを空にして実行します。

```sh
npm run check
npm run test:cloudflare
npm run test:browser
npm run cf:preview
```

確認用DBへの移行、初期サイトの登録、Previewへの配備を行います。Accessで入場し、表示名とパスキーを登録します。確認環境の最初のユーザーは、Accessで認証されたメールに固定されます。

## 7. 本番のSecretを設定する

本番には、実行時Secretの`JEV_API_KEY`と`ADMIN_TOKEN`が必要です。API Tokenとは別のものです。最初の管理者を登録するADMIN_TOKENは、ランダムな32文字以上にします。

```sh
npx wrangler secret put JEV_API_KEY
npx wrangler secret put ADMIN_TOKEN
```

本番AUTH_SECRETは、まだない場合、明示的な本番リリース操作の中で独立した値を生成して設定します。Previewの値をコピーしません。既存環境の値は上書きしません。

## 8. 確認後に本番へリリースする

```sh
npm run cf:release -- --reviewed-commit FULL_40_CHARACTER_COMMIT_SHA
```

[PreviewからProductionへ](./preview-production)の条件を満たした場合だけ本番の移行と配備を行います。本番の`/admin`で、初回ADMIN_TOKENを使って最初のSuperuserとパスキーを登録します。以後のログインはパスキーです。

最後にサイト設定・[共通タグ](../integration/sdk)・通常の判断と表示を確認してください。
