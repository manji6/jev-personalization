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
