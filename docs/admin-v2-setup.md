# 新管理画面のセットアップ・移行

まず[マニュアルのローカル確認](manual.md#1-公開せずに一通り試す)で実機パスキーと操作を確認してください。この作業記録では本番のSecrets・DB・公開バージョンを変更していません。

## Cloudflareの既存環境を切り替える場合

現在のWorker、D1、サイトID、設置済みタグは継続できます。Workersの新コードだけを配備しても、AUTH_MODE未設定の環境は初回切り替え前まで旧画面を使用します。以下は運用者が切り替え時に実施する手順です。

### 1. バックアップと適用対象を確認

D1のTime Travel復旧位置とコードのコミットを控え、D1のバックアップも取得します。管理者DBを含むバックアップはアクセス制限して保管してください。ユーザー・公開鍵・招待のハッシュ・独自コードなども入ります。

```sh
npx wrangler d1 export DB --remote --output backup-before-admin-v2.sql
```

GitHub Buildsの本番対象ブランチを確認します。レビュー中のブランチを自動で本番へ反映しないでください。別環境を使う場合はD1・Worker・Secrets・費用カウンターを分離してください。

### 2. 実行時設定を用意

| 名前        | 種類       | 設定内容                                                                                 |
| ----------- | ---------- | ---------------------------------------------------------------------------------------- |
| AUTH_MODE   | 通常変数   | `passkey`                                                                                |
| AUTH_ORIGIN | 通常変数   | 管理画面の正確なOrigin。現在の運用先なら`https://jev-personalization.manji6.workers.dev` |
| AUTH_SECRET | Secret     | 新しいランダムな32文字以上。ADMIN_TOKEN/JEV_API_KEYとは別の値                            |
| ADMIN_TOKEN | 既存Secret | 既存の値を初回Superuser登録の確認に使用。重複のキーを作らない                            |
| JEV_API_KEY | 既存Secret | 通常判定用。既存の設定を継続                                                             |

AUTH_ORIGINは末尾`/`・パス・クエリを付けません。安定したホスト名を選んでください。登録後にRP IDを変えるドメイン移転では、パスキーをそのまま移せません。同じ環境で複数の管理Originを受け付ける設定はありません。

SecretはCloudflareのWorker実行時設定で登録します。値をGitやチャットへ貼らないでください。CLIを利用する場合も引数へ値を含めず、対話入力を使います。

```sh
npx wrangler secret put AUTH_SECRET
```

既存のJEV_MODEL・DAILY_REQUEST_BUDGET・MAX_CONCURRENTは初回切り替え時の初期値として引き継ぎます。その後は新管理画面の「JevSense管理」が設定元になります。これらの通常変数を書き換えても、移行済みのDB設定を上書きしません。

### 3. マイグレーションとコードを適用

`npm run cf:deploy`は、ビルド→D1マイグレーション→Worker配備を実行する**本番変更**のコマンドです。レビュー中に実行しないでください。

```sh
npm ci
npm run cf:deploy
```

GitHub Buildsから適用する場合の設定は[Cloudflare手順](cloudflare.md)を参照してください。新管理画面に切り替える実行時変数も、コードと同じ切り替えで有効にします。先に変数だけを有効化した状態や、0002未適用で新APIを公開した状態を運用しません。

0002はテーブル・インデックス・保護トリガーを追加する非破壊の移行です。既存app_configのサイトを一旦コピーし、初回Superuser登録の完了時に**その時点の最新app_config**を改めてコピーします。サイト/施策IDは維持します。既存施策の質問を書き換えません。

### 4. 最初のSuperuserを登録

`/admin`を開き、表示名・メール・既存ADMIN_TOKENを入力してパスキーを登録します。未完了なら以前の公開設定が判定に使われます。登録の成功時だけ、管理ユーザー・パスキー・サイトコピー・切り替えを同一DBバッチで確定します。

完了後は管理トークンでのログインと旧管理APIを受け付けません。既存タグはそのまま使えますが、実ページプレビューにはこの版のSDKが必要です。SDKのCDNキャッシュは最大5分なので、確認時は最新版が読み込まれていることを確認します。

Superuserは予備パスキーと復旧コードを登録し、できれば別の信頼できるユーザーも招待してSuperuserにしてください。最後の有効なSuperuserと最後のパスキーは削除/降格できません。初回登録後はADMIN_TOKENをログインの復旧手段として使えません。

### 5. 既存サイトと実機を確認

サイトID・Origin・経路・共通デザイン・登録済み質問・有効/無効が維持されたか確認します。通常の判定、診断、下書き保存、停止中施策の実ページプレビュー、別ユーザーのサイト権限を確認します。Jevキーや本番利用者情報を診断のスクリーンショットに含めないでください。

## Node.jsでの運用

Node.js24以上と永続ディスクを使います。新しいエントリーポイントは`npm start`（src/app.js）です。既存の設定JSONは管理DBを初めて作る際の移行元です。管理開始後の更新元はSQLiteになります。

```sh
npm ci
npm run build
```

実行環境へAUTH_MODE=passkey、AUTH_ORIGIN、AUTH_SECRET、初回用ADMIN_TOKEN、通常判定用JEV_API_KEYを設定してください。必要に応じてCONFIG_PATH（移行元）、ADMIN_DB_PATH（既定data/administration.sqlite）、HOST/PORTも設定し、`npm start`します。Node.jsの既定リッスンは127.0.0.1:3000です。

HTTPSリバースプロキシで管理OriginとHostを維持してください。固定Originと実際のHostが違う管理要求は拒否されます。SQLiteとWALを同じ永続ボリュームへ置き、停止中のバックアップまたはSQLite対応の整合性のあるバックアップを使ってください。Node.js版は単一プロセス運用で、費用カウンターは再起動でリセットされます。

Dockerfileも新エントリーポイントとSQLマイグレーションを含みます。/app/dataに永続ボリュームを割り当ててください。`npm run start:legacy`は切り替え前の旧構成用で、移行済みDBを旧方式へ戻す手段ではありません。

## 障害時と復旧

- 登録/認証失敗：AUTH_ORIGIN・実アクセスURL・RP ID、端末のパスキー、Cookie、時刻、HTTPSを確認します。Originをrequest Hostから自動推測する変更はしません。
- 切り替え完了後にAUTH_MODEを削除しても、旧方式には戻らず503で拒否します。コードだけ古い版へ戻さないでください。切り替え後の公開設定はadmin_sitesにあり、app_configは凍結しています。旧JSONを使うコードへ戻すと最新の変更を失います。
- 0002とAUTH_MODE=passkeyを保った修正版へのロールフォワードを優先します。過去へ戻す必要がある場合はメンテナンス中にコードとDBを同じ復旧位置へ戻し、そこで失われる管理操作を確認してください。
- 最新設定の退避にはadmin_sitesのbodyを集めた`{"version":1,"sites":[...]}`を使います。新しいname/judgment・1000文字の質問を受け取れない古いバイナリへの変換は別途確認が必要です。文章を無断で切り詰めません。
- 全員がパスキーと復旧コードを失った場合は、D1/SQLiteを操作できる環境運用者が、本人確認とバックアップの後、復旧する有効なSuperuser向けにadmin_invitationsへ5分のrecovery行を発行します。token_hashは32バイト乱数のbase64url値をSHA-256してbase64url化したもの。kind=recovery、email/target_user/created_byは対象の有効Superuser、created_at=現在のUnixミリ秒、expires_at=5分後、used=0とし、元の乱数を`/admin/recover#token=...`で本人へ一度だけ共有します。APIと同じ制約で新パスキーを登録し、旧資格を無効にします。この操作は公開のメール復旧APIやADMIN_TOKENの再有効化にはしません。
- 停止・全体権限変更でユーザーの管理セッションと復旧資格を取り消します。AUTH_SECRETの変更は診断認可を無効にします。管理セッションも終了する必要があるときは「他のログインをすべて終了」または運用者によるadmin_sessionsの失効を併用します。

管理DBのバックアップや一時的な復旧リンクは秘密情報として扱います。アプリの通常ログは無効のままです。Cookie・CSRF・challenge・招待/復旧/確認チケット、要求本文をプロキシやAPMへ記録しないでください。
