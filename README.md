# JevSense（ジェブセンス）

運用先の[管理画面](https://jev-personalization.manji6.workers.dev/admin)。初回利用にはCloudflare側のSecrets登録が必要です。[配備記録](docs/deployment.md)を参照してください。

JevSenseは、ユーザーの意図や文脈を察知・判定し、ふさわしい体験を届けるパーソナライズ基盤です。サイト共通のscriptタグで取得した閲覧情報を、自前APIで加工し、Jevの判断に基づいて登録済みコンテンツを表示する参照実装です。BtoB、メディア、採用、教育、予約、ECなどで利用できます。Node.js 24以上。

ブラウザが履歴を保持し、サーバーには閲覧者ID・セッションストア・履歴DBを持ちません。判断時に許可されたページ情報と必要な行動履歴が自前APIとJevへ送信されます。

## ドキュメント

- [導入・使い方マニュアル](docs/manual.md)
- [詳細設計](docs/design.md)
- [オファー表示・共通デザイン設計](docs/offers.md)
- [本番運用・セキュリティ](docs/operations.md)
- [Cloudflareセットアップ手順](docs/cloudflare.md)
- [検証結果と限界](docs/validation.md)
- [先行する6件のJev実測](experiments/adobe-ja/README.md)

## Cloudflareで使う

Workers＋Static Assets＋D1＋Durable Objectsに対応しています。[セットアップ手順](docs/cloudflare.md)の順にD1作成、wrangler.jsonへのID設定、GitHub連携、Secrets登録を行います。初回設定後はPushから自動デプロイできます。施策設定はD1へ保持され、コードの再デプロイで初期化されません。

```sh
npm ci
npm run cf:migrate:local
npm run dev:cloudflare
```

上記はローカル起動です。リモートへの本番デプロイは手順書を確認して実施してください。

## Node.jsで使う

```sh
npm ci
npm run build
mkdir -p data
cp config/example.json data/config.json
# ADMIN_TOKEN（ランダムな32文字以上）とJEV_API_KEYを秘密管理サービスから設定
npm start
```

既定は127.0.0.1:3000。HTTPSのリバースプロキシ経由で提供してください。管理画面は`/admin`です。サンプルはメタデータ送信・施策とも無効で、実サイトの許可経路を確認してから有効化します。環境変数の値や本番設定はGitへ保存しません。

```sh
npm run check
npm run test:cloudflare
npx playwright install chromium
npm run test:browser
```

単一管理者向けの初期リリースです。Node.js版は単一プロセス用、Workers版はD1の条件付き更新と共有クォータで複数の実行インスタンスに対応します。任意の口語の完全自動コンパイル、組織別の認証・課金は提供していません。質問案は人が確認します。本番公開前にサイト固有のプライバシー審査、外部APIの保持条件確認、TLS・アクセス制御・費用上限の設定と実環境の負荷試験が必要です。公開準備の具体的な範囲は運用文書に記載しています。

実サイトでの計測・送信・判定の確認は[デバッグパネル](docs/debugging.md)を参照してください。

管理画面v2の認証・サイト所属・画面構造は[検討資料](docs/admin-v2-plan.md)と[操作モック](docs/prototypes/admin-v2.html)を参照してください。`/admin-preview`で架空データのモックを表示できます。本番のパスキー認証・ユーザー管理への移行は、モック確認後の段階で実装します。
