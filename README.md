# JevSense（ジェブセンス）

運用先の[管理画面](https://jev-personalization.manji6.workers.dev/admin)。初回利用にはCloudflare側のSecrets登録が必要です。[配備記録](docs/deployment.md)を参照してください。

JevSenseは、ユーザーの意図や文脈を察知・判定し、ふさわしい体験を届けるパーソナライズ基盤です。サイト共通のscriptタグで取得した閲覧情報を、自前APIで加工し、Jevの判断に基づいて登録済みコンテンツを表示する参照実装です。BtoB、メディア、採用、教育、予約、ECなどで利用できます。Node.js 24以上。

ブラウザが履歴を保持し、サーバーには閲覧者ID・閲覧者のセッションストア・行動履歴DBを持ちません。管理者のアカウント・所属サイト・管理セッションは別の管理DBに保持します。判断時に許可されたページ情報と必要な行動履歴が自前APIとJevへ送信されます。

## ドキュメント

- [導入・使い方マニュアル](docs/manual.md)
- [管理画面v2の詳細設計](docs/admin-v2-design.md)
- [パスキー対応版のセットアップ・移行](docs/admin-v2-setup.md)
- [受入テストと確認方法](docs/admin-v2-validation.md)
- [判断エンジンの詳細設計](docs/design.md)
- [オファー表示・共通デザイン設計](docs/offers.md)
- [本番運用・セキュリティ](docs/operations.md)
- [Cloudflareセットアップ手順](docs/cloudflare.md)
- [検証結果と限界](docs/validation.md)
- [先行する6件のJev実測](experiments/adobe-ja/README.md)

## ブラウザでPreviewを確認する

[確認用管理画面](https://admin-v2-jev-personalization.manji6.workers.dev/admin)をCloudflare Accessで保護しています。本番と別のD1・パスキー・費用カウンターを使用し、現在のJev判断はテスト用スタブです。[入場・確認・本番リリースの手順](docs/cloudflare-preview.md)を参照してください。

`npm run cf:preview`で確認版を更新します。本番反映は、確認後に`npm run cf:release -- --reviewed-commit <SHA>`を明示的に実行します。Pushや通常のCIだけでは本番へ配備しません。

## 公開せずに新管理画面を試す

```sh
npm ci
npm run review
```

**http://localhost:4174/admin** を開きます。初回トークンは`local-review-only-not-a-production-token`。ローカル専用で、実際のパスキー・SQLite・施策管理・プレビューを利用できます。Jevだけは課金しない固定スタブです。確認用ページはhttp://localhost:4174/demo。手順は[マニュアル](docs/manual.md)を参照してください。

## Cloudflareで使う

Workers＋Static Assets＋D1＋Durable Objectsに対応します。[既存の基盤設定](docs/cloudflare.md)に加え、[パスキー方式への移行](docs/admin-v2-setup.md)を行います。AUTH_MODE=passkey、固定AUTH_ORIGIN、独立したAUTH_SECRETが必要です。既存ADMIN_TOKENは最初のSuperuser登録だけに使います。切り替え前の環境は旧画面を維持し、公開中の設定は移行時に引き継ぎます。

この変更の確認では本番デプロイやリモートDB変更を行っていません。

## Node.jsで使う

Node.js24以上。永続ディスク、HTTPS、管理DBのバックアップを用意します。

```sh
npm ci
npm run build
mkdir -p data
cp config/example.json data/config.json
# 実行環境へAUTH_MODE / AUTH_ORIGIN / AUTH_SECRET / ADMIN_TOKEN / JEV_API_KEYを設定
npm start
```

既定は127.0.0.1:3000。管理DBはdata/administration.sqlite。初回登録後の更新先は管理DBです。設定JSONは新規DBの初期データにだけ使います。値や本番設定をGitへ保存しません。詳細は[運用・移行手順](docs/admin-v2-setup.md)に記載しています。

```sh
npm run format:check
npm run check
npm run test:cloudflare
npx playwright install chromium
npm run test:browser
npm run cf:dry-run
```

1人のログインユーザーが複数サイトに所属でき、Superuser/サイト管理者/編集者/閲覧者を区別します。生成AIによる質問変換、メール配送、成果集計、課金、画像アップロードは含みません。実機パスキー・Safari/Firefox・運用規模での負荷検証の範囲は[受入記録](docs/admin-v2-validation.md)を参照してください。

実サイトの計測・送信・判断は[デバッグパネル](docs/debugging.md)で確認できます。[操作モック](docs/prototypes/admin-v2.html)と[検討履歴](docs/admin-v2-plan.md)も残しています。モックは本実装の認証とは異なり、`npm run preview:admin`で画面検討用にのみ使えます。
