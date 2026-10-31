# Cloudflareセットアップ手順

パスキー対応の新管理画面は、以下の基盤設定に加えて[新管理画面への移行手順](admin-v2-setup.md)が必要です。AUTH_MODE・AUTH_ORIGIN・AUTH_SECRETを使います。以下のADMIN_TOKEN入力によるログイン説明は切り替え前の旧方式です。

Cloudflare Workers版を実装しています。管理画面・SDK・判断APIを1つのWorkerで提供し、施策設定はD1へ保存します。閲覧者の履歴・表示状態はブラウザ内に保持します。今後の更新は[Previewで確認してからProductionへリリース](cloudflare-preview.md)する手順を使います。

本リポジトリの運用先には初回デプロイを実施済みです。[初回配備記録](deployment.md)を参照してください。以下は新しい運用先を作る場合の手順です。Secretsの値は利用者がCloudflareで登録します。Node.js版も引き続き使用できます。

## 構成

| 部品                       | Cloudflareサービス           | 保存するもの                                    |
| -------------------------- | ---------------------------- | ----------------------------------------------- |
| 管理画面・SDK              | Workers Static Assets        | 配布用HTML・CSS・JavaScript                     |
| 判断・管理API              | Workers                      | 要求中の処理だけ。履歴の永続保存なし            |
| 施策・サイト設定           | D1（DBバインディング）       | サイト設定、質問、配信条件、コンテンツ          |
| 外部APIキーと管理認証      | Workers Secrets              | JEV_API_KEY、ADMIN_TOKEN                        |
| 日次費用上限・同時実行制御 | SQLite-backed Durable Object | UTC日単位の要求件数、短時間のサーバー要求許可票 |
| 要求頻度の制限             | Rate Limiting binding        | エッジの短期要求カウンター                      |

D1は管理用設定DBです。閲覧者ID・閲覧者セッション・行動履歴DBは作りません。共有クォータにも閲覧者やページ情報を渡しません。

## 先に用意するもの

- CloudflareアカウントとWorkers/D1/Durable Objectsを使えるプラン。SQLite-backed Durable Objectsを使用します。プラン別の料金・上限は契約時に確認してください。
- このコードが入っているGitHubリポジトリと、デプロイするブランチ。本リポジトリでは`main`です。自分のアカウントで運用する場合はForkまたは複製してください。
- JevのAPIキー。Cloudflare側で名前を`JEV_API_KEY`にします。
- ランダムな32文字以上の管理トークン。Cloudflare側で名前を`ADMIN_TOKEN`にします。

キーや管理トークンをGitHubのファイルへ書かないでください。この開発環境に設定されたキーはCloudflareへ自動転送されません。

## A. 初回：D1を作ってリポジトリを設定する

### 1. コードを取得する

```sh
git clone --branch main https://github.com/manji6/jev-personalization.git
cd jev-personalization
npm ci
```

Forkした場合は取得先を自分のリポジトリに置き換えます。`wrangler.json`には本リポジトリの運用先のaccount_idとdatabase_idが入っています。別アカウントで使う場合はaccount_idを自分のCloudflareアカウントIDへ変更し、以降の手順で自分のD1 IDとWorker名を設定してください。

### 2. D1データベースを作る

CloudflareダッシュボードのD1から、設定用の空データベースを作成し、Database ID（UUID）を控えます。CLIからなら次の方法も使えます。

```sh
npx wrangler login
npx wrangler d1 create jev-personalization-config
```

この操作は実際のCloudflareリソースを作成します。運用先のアカウントで実行してください。

### 3. D1のIDとWorker名を設定する

```sh
npm run cf:configure -- YOUR_D1_DATABASE_UUID your-jev-worker
```

`YOUR_D1_DATABASE_UUID`を実際のDatabase IDへ、`your-jev-worker`をアカウント内で重複しないWorker名へ置き換えます。このコマンドは`wrangler.json`だけを変更し、リソース作成やデプロイはしません。

`wrangler.json`の`d1_databases[0].database_id`と`name`を確認し、変更をGitHubへcommit・Pushします。Database IDは秘密情報ではありません。IDを未設定のまま`cf:deploy`を実行すると、誤ったDBを作らず、手順を示して停止します。

Rate Limitingの`namespace_id`はサンプルで`1001`です。同じアカウントでほかのアプリが使っている場合は、重複しない数値文字列へ変更してください。

CLIを使いたくない場合は、GitHub上で`wrangler.json`に次のように`database_id`を追加しても同じです。既存の項目は維持します。

```json
{
  "binding": "DB",
  "database_name": "jev-personalization-config",
  "database_id": "実際のD1のUUID",
  "migrations_dir": "migrations"
}
```

## B. GitHubとCloudflareを連携する

CloudflareのWorkers & PagesからGitHubリポジトリを接続してWorkerを作成するか、作成済みWorkerのBuilds設定からGitHubを接続します。ダッシュボードの名称は更新される場合があります。

| 設定               | 値                                  |
| ------------------ | ----------------------------------- |
| Worker名           | `wrangler.json`のnameと同じ         |
| リポジトリ         | このコードを保存したリポジトリ      |
| 本番ブランチ       | `main`、または自分の運用ブランチ    |
| ルートディレクトリ | リポジトリのルート                  |
| ビルドコマンド     | `npm run build:cloudflare`          |
| デプロイコマンド   | `node scripts/deploy-cloudflare.js` |

依存関係のインストールにはコミット済みのpackage-lock.jsonを使用します。ビルド環境はNode.js 24に合わせてください。

デプロイスクリプトは、まず`wrangler d1 migrations apply DB --remote`を実行し、成功した場合だけ`wrangler deploy`を実行します。初期マイグレーションは施策とメタデータ送信が無効なサンプルを1件だけ登録します。2回目以降のデプロイで既存設定は上書きしません。

Buildsのデプロイ用トークンには、対象アカウントのWorkersスクリプト更新とD1編集が必要です。ビルドでD1に対する403が出た場合は、Buildsのトークン権限と対象アカウントを確認してください。Jevのキーはこのデプロイトークンとは別です。

新管理画面の確認にはWorker Previewsを構成しています。Previewは専用D1・専用Durable Object・Access保護を使用します。設定は[Preview手順](cloudflare-preview.md)を参照してください。Productionの自動デプロイは行わず、確認済みコミットを指定してリリースします。

## C. Secretsを登録する

Workerの環境設定で、以下を**Secret**として追加します。ビルド時の変数ではなく、Worker実行時に使う秘密情報です。

管理トークンはCloudflareが自動発行するものではなく、自分で作る管理画面用のパスワードです。例えば手元で次を実行すると、64文字のランダム値を作れます。生成した値は秘密として保管し、管理画面にも同じ値を入力します。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| 名前        | 値                                 |
| ----------- | ---------------------------------- |
| JEV_API_KEY | 利用するJevのAPIキー               |
| ADMIN_TOKEN | ランダムな32文字以上の管理トークン |

CLIでも、初回デプロイ後に対話入力で登録できます。

```sh
npx wrangler secret put JEV_API_KEY
npx wrangler secret put ADMIN_TOKEN
```

値をコマンドの引数に書かず、入力プロンプトから登録します。ダッシュボードで変更した場合は、その変更の保存・デプロイを完了してください。Secrets未設定でも管理画面のHTMLは開けますが、管理APIは`server_not_configured`、Jevキーだけが不足する場合の判断は`model_not_configured`となり保留します。

通常の公開設定は`wrangler.json`のvarsにあります。

| 名前                 | 既定値     | 意味                                      |
| -------------------- | ---------- | ----------------------------------------- |
| JEV_MODEL            | jev-1.14.0 | Jevへ指定する固定バージョン               |
| DAILY_REQUEST_BUDGET | 1000       | UTC日単位で許可するJev要求数。0で全件停止 |
| MAX_CONCURRENT       | 10         | 同時に許可するJev要求数                   |

これらは秘密情報ではありません。リポジトリ側の設定を変更してデプロイします。日次クォータはWorker再起動や通常のデプロイでも保持されます。モデル障害も要求数に算入し、自動再試行しません。Durable Objectのクラス削除・名前変更やリソースの作り直しでは状態が変わるため、運用中は行わないでください。

## D. デプロイ後の確認とタグ設置

1. デプロイ先の`https://your-jev-worker.<subdomain>.workers.dev/health`が`{"ok":true}`を返すことを確認します。これはプロセスの応答確認であり、Jev残高やSecretsの確認ではありません。
2. 同じホストの`/admin`を開き、ADMIN_TOKENの値を入力して設定を読み込みます。
3. [使い方マニュアル](manual.md)に従ってサイトのorigins、許可経路、施策を設定します。サンプルは配信停止状態です。
4. 管理画面と`/admin/api/*`には、Cloudflare Access等で追加のアクセス制限を設けることを推奨します。`/sdk.js`と`/v1/*`は公開サイトのSDKが使うため、管理者向け認証で塞がないでください。
5. 対象サイトの共通テンプレートへタグを1つ設置します。

```html
<script
  defer
  src="https://your-jev-worker.<subdomain>.workers.dev/sdk.js"
  data-site="my-site"
></script>
```

`data-site`は管理画面のサイトIDと一致させます。同意取得後に`window.JevPersonalization.consent(true)`を呼び出します。対象サイトにCSPがある場合は、このWorkerのホストをscript-srcとconnect-srcに追加します。

サイト自体のタグ設置はCloudflareへのアプリ配備とは別作業です。GitHub連携だけで他のWebサイトへタグが挿入されることはありません。

## CLIだけで配備する場合

D1作成と`cf:configure`の完了後、次のコマンドで初回・通常のデプロイを行えます。

```sh
npm run cf:release -- --reviewed-commit FULL_40_CHARACTER_COMMIT_SHA
```

これはビルド、リモートD1マイグレーション、Workerデプロイを実行するため、本番への変更操作です。検証だけの場合は`npm run cf:dry-run`を使います。dry-runはアップロードやリソース作成をしません。

## ローカル開発

```sh
npm ci
npm run cf:migrate:local
npm run dev:cloudflare
```

ローカルのD1とDurable Objectsは`.wrangler/`に保存され、本番には接続しません。`.dev.vars`を必要に応じて作り、ADMIN_TOKENとJEV_API_KEYを設定します。このファイルはGitの除外対象です。キーなしなら管理画面のHTML確認まで可能です。APIの利用には管理トークンが必要です。

`http://localhost:8787/admin`で管理画面を開けます。SDK自体はHTTPS用なので、対象サイトまで含むローカル検証には信頼できるHTTPS環境を用意してください。`wrangler dev --remote`はこの手順では使いません。実キーで適格な閲覧を送ると、ローカルでもJevへの実要求が発生します。

```sh
npm run check
npm run test:cloudflare
npm run test:browser
npm run cf:dry-run
```

Cloudflare統合テストはworkerd、実D1エミュレーター、実Durable Objectsを使い、Jevだけをモックします。有料のJevリクエストは送りません。

## 日常の更新・停止・復旧

- コードの更新：運用ブランチへPush → Workers Buildsがビルド → マイグレーション → デプロイ。
- 施策の更新：管理画面で反映・保存。GitHubへのPushやアプリ再デプロイは不要です。
- 全体のJev要求停止：DAILY_REQUEST_BUDGETを0にしてデプロイ。施策単位なら管理画面で停止して保存します。
- バックアップ：D1の管理設定をバックアップ。閲覧者履歴のバックアップはありません。
- ロールバック：Workerの以前のバージョンへ戻す操作と、D1の設定・スキーマを戻す操作は別です。今後のDB変更は旧コードとも互換性を保つ追加的変更から行ってください。

エッジのRate LimitingはIPごと60要求/60秒で、Cloudflareロケーション単位の近似的な制限です。IPはアプリのD1やDurable Objectに保存しません。CORSやIP制限だけでは費用攻撃を完全には防げないため、共有の日次クォータと併用します。管理画面が全利用者を扱う単一管理者向けである点や、Jevのデータ保持条件を確認する必要はNode.js版と同じです。

## 変更したコード

- `src/cloudflare/worker.js`：Workers用ルーティング、認証、CORS、サイズ制限、静的配信と判断API。
- `src/cloudflare/store.js`：D1からのprimary readと条件付きUPDATEによる保存競合の防止。
- `src/cloudflare/budget.js`：Durable Objectでの永続日次クォータと短時間の同時実行許可。
- `wrangler.json`：Assets、D1、Durable Objects、Rate Limiting、公開設定。
- `migrations/0001_config.sql`：管理設定テーブルと非破壊の初期データ。
- `scripts/*cloudflare.js`：ビルド、初回設定、デプロイ用コマンド。
- `test/cloudflare.test.js`：Cloudflare実行環境の統合テスト。

## 公式資料

- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Wrangler設定](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

確認日：2026-10-30（日本時間）。本リポジトリの運用先で初回デプロイと公開URLの疎通を確認済みです。GitHub Buildsによる自動デプロイの連携と、Secrets登録後の実Jev呼び出しは別途確認が必要です。
