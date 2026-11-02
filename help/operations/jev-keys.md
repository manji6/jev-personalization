# サイト専用キーを安全に運用する

環境の運用者向けの手順です。サイト管理者は[管理画面のJev連携](../guides/jev)を使います。ここで作る**暗号化キー**と、Jevから発行された**APIキー**は別のものです。

## 保存方式

APIキーはAES-256-GCMで暗号化して専用テーブルへ保存します。暗号化キーはDBに入れず、Cloudflareの実行時SecretまたはNode.jsの秘密管理機構で保持します。サイトIDと更新版に結び付けて暗号文を検証するため、他サイトへコピーして使うことはできません。

DBを読めるだけの人から値を保護します。アプリのプロセスと暗号化キーの両方を掌握した運用者まで隔離する仕組みではありません。管理画面には設定有無だけを表示し、キーを復元表示するAPIはありません。

## 初回だけ暗号化キーを生成する

既にJEV_KEYRINGを設定している環境では、新しい値を上書きしないでください。値を失うと保存済みAPIキーを復号できなくなります。PreviewとProductionには別々の暗号化キーを使います。

```sh
npm run jev:keyring:create -- data/preview-jev-keyring.json
```

暗号化キーを含むJSONファイルを権限0600で作成します。値はターミナルへ表示せず、既存ファイルは上書きしません。`data/`はGit対象外です。ファイルをGit・チャット・公開成果物へ追加しないでください。Windowsや別のファイルシステムではACLも確認します。

## Cloudflare Preview

まず設定名だけを確認し、JEV_KEYRINGが既にある場合は継続利用します。

```sh
npx wrangler preview secret list --name YOUR-PREVIEW-NAME --json
```

未設定の場合だけ、新しく生成した確認用JSONを標準入力で渡します。

```sh
npx wrangler preview secret put JEV_KEYRING --name YOUR-PREVIEW-NAME < data/preview-jev-keyring.json
```

通常のvars、Build変数、共有Previews Baseへ置く方法は使いません。このプロジェクトはBaseを継承しません。Preview自身のSecretは次の配備にも保持されます。続けて[Previewの配備](../getting-started/preview-production)を行い、管理画面の「Jev連携」で暗号化設定の案内が消えることを確認します。

## Cloudflare Production

**本番更新が承認されてから**、設定名を確認し、未設定の場合だけ別のファイルを生成・登録します。

```sh
npx wrangler secret list
npm run jev:keyring:create -- data/production-jev-keyring.json
npx wrangler secret put JEV_KEYRING < data/production-jev-keyring.json
```

上の生成・登録は初回用です。既存のJEV_KEYRINGがある場合は実行せず、鍵の世代更新手順を使います。Secretの変更そのものも実行環境の更新です。確認前にProductionへ実施しないでください。

各サイトだけでAPIキーを管理するなら、共通JEV_API_KEYは不要です。共通モードのサイトは、共通キーがなければ保留になります。Production配備ではADMIN_TOKENと、JEV_API_KEYまたはJEV_KEYRINGの少なくとも一方が必要です。サイト専用キーを使うにはJEV_KEYRINGが必要です。

## Node.js

```sh
npm run jev:keyring:create -- data/node-jev-keyring.json
```

実行環境の`JEV_KEYRING_FILE`へそのファイルの絶対パスを指定し、Node.jsの実行ユーザーだけが読めるようにします。永続化し、DBと別にアクセス制限してバックアップします。秘密管理サービスからJSONを実行時`JEV_KEYRING`へ渡す方式でも構いません。両方指定した場合はJEV_KEYRINGを優先します。

`npm run review`は確認用DBに隣接する`.jev-keyring.json`を初回に自動生成して再利用します。固定判定なので、APIキーを保存しても実Jevへは送りません。

## バックアップと鍵の世代更新

DBのバックアップだけではAPIキーを復元できません。対応する暗号化キーを秘密管理サービスへ別途バックアップし、読める担当者を限定します。Cloudflare Secretは値を後から再取得する機能を前提にしないでください。

1. 安全な環境で新しい32バイト乱数を生成し、既存JSONのkeysへ新しい世代名で追加する。旧世代の値を保持する。
2. activeを新世代へ変え、JEV_KEYRINGを更新する。旧世代はまだ削除しない。
3. 各サイトで「サイト専用キー」を選んだまま、APIキーを空欄で保存する。現在の値を新世代で再暗号化する。
4. 全サイトの移行とバックアップの復旧方針を確認してから、不要な旧世代を削除する。必要な過去のバックアップ用の鍵は、別途安全に保持する。

JSONは`active`と`keys`を持ちます。各鍵は32バイトのbase64url（末尾の`=`なし）、世代名は英数字・アンダースコア・ハイフンで最大40文字、世代数は最大10です。AUTH_SECRETの更新とは独立しています。

## 漏洩・紛失・切り戻し

APIキーが疑わしい場合はJev側で再発行・失効し、サイトの「Jev連携」から置き換えます。アプリでの削除だけでは提供元のキーは失効しません。

暗号化キーが漏洩した場合、DBへのアクセス状況も確認し、必要なら保存していた全サイトのAPIキーを提供元で失効・再発行します。暗号化キーを更新するだけで、既に流出した旧暗号文を無効にはできません。

暗号化キーを失った場合は対応するバックアップから復旧するか、新しい暗号化キーと、各サイトのAPIキーを登録し直します。共通キーへ自動で切り替えて処理を続けることはありません。

サイト専用キーや利用停止を設定した後に、対応前の古いコードだけへ戻すと共通キーで呼び出すおそれがあります。対応版への修正配備を優先し、切り戻しが必要ならコード・DB・暗号化キーを同じ復旧位置で検討してください。
