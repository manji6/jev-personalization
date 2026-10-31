# Node.jsで動かす

Node.js 24以上、永続ディスク、HTTPSのリバースプロキシを用意します。Node.js版は単一プロセスでの運用を対象にしています。

## インストール

```sh
git clone --branch feature/admin-v2-implementation https://github.com/manji6/jev-personalization.git
cd jev-personalization
npm ci
npm run build
mkdir -p data
cp config/example.json data/config.json
```

サンプルのメタデータ送信と施策は無効です。自分のサイトの情報を確認してから有効にしてください。

## 実行時設定

| 名前          | 内容                                      |
| ------------- | ----------------------------------------- |
| AUTH_MODE     | passkey                                   |
| AUTH_ORIGIN   | 管理画面の正確なHTTPS Origin              |
| AUTH_SECRET   | 独立したランダムな32文字以上の秘密情報    |
| ADMIN_TOKEN   | 初回Superuser登録用のランダムな32文字以上 |
| JEV_API_KEY   | 実判定用のJevキー                         |
| CONFIG_PATH   | 初期データ。既定data/config.json          |
| ADMIN_DB_PATH | 管理DB。既定data/administration.sqlite    |
| HOST / PORT   | 既定127.0.0.1 / 3000                      |

Secretは運用環境の秘密管理サービスで渡すことを推奨します。ローカルの`.env`を使う場合、通常の`npm start`が自動で読み込むとは仮定せず、Node.jsの`--env-file`等で明示的に読み込ませてください。`.env`はGitへ追加しません。

```sh
# 実行環境に変数を渡した場合
npm start

# ローカルのGit対象外.envを明示して使う場合
node --env-file=.env src/app.js
```

## HTTPSとプロキシ

AUTH_ORIGINとブラウザで開くURLを一致させます。プロキシでHostを正しく維持してください。HostやOriginからRP IDを自動推測して許可する構成ではありません。

開発用の`http://localhost`だけは例外です。公開ホストをHTTPのまま使うことはできません。簡単な確認は[ローカル体験](./quickstart)を使ってください。

## 初回登録

`/admin`を開き、表示名・メール・ADMIN_TOKENでパスキーを登録します。最初のユーザーはSuperuserです。登録後は予備パスキーと復旧コードも用意します。

管理開始後の更新先はSQLiteです。初期JSONを書き換えても、既存の管理DBを上書きしません。

## 永続化とバックアップ

SQLite本体とWALを同じ永続ボリュームに置きます。停止中のバックアップ、またはSQLiteに対応した整合性のある方法を使ってください。設定だけでなく、管理者や認証情報のDBも保護します。

Node.jsの費用カウンターはプロセス内で、再起動によりリセットされます。複数インスタンスでの費用上限共有は用意していません。

Dockerfileは非rootで動かす配備例です。`/app/data`へ実行ユーザーが書ける永続ボリュームを割り当て、同じ実行時変数を設定します。
