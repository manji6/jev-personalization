# SDKタグと追加連携

サイト共通タグを1つ設置します。ページごとの商品IDや説明の登録を必須にしません。サイト設定の権限、実装サイトを編集する権限、利用者の同意設計が必要です。

## 共通タグ

```html
<script
  src="https://YOUR-API-HOST/sdk.js"
  data-api="https://YOUR-API-HOST"
  data-site="YOUR-SITE-ID"
></script>
```

`data-site`は管理画面のサイトIDと一致させます。APIのOriginはHTTPSです。ローカル開発のlocalhostだけHTTPを許可します。

管理画面の「動作確認」に、選択中サイトのタグ例も表示します。APIのJevキーや管理用トークンをタグへ入れないでください。

## 同意後に開始する

SDKの読み込み完了後、CMP等で同意を取得したときに呼びます。

```js
window.JevPersonalization.consent(true);
```

同意前は観測・通常送信を開始しません。撤回は次です。

```js
window.JevPersonalization.consent(false);
```

撤回時には、このSDKが使うブラウザ内の対象履歴も消去します。

すでに適切な同意取得が済んでいる場合だけ、タグへ`data-consent="granted"`を付ける方法も使えます。単にタグが読み込まれたという理由で同意済みにしないでください。

読み込み前にAPIを呼ぶと失敗するため、CMPとタグの実行順序を調整します。利用サイトのタグマネージャーやSPAの構成に合わせてください。

## 管理画面の設定

- オリジンに実サイトのOriginを登録する。
- 収集する経路と除外経路を設定する。
- ページ情報を確認し、メタデータ送信を有効にする。
- 施策を作り、表示対象パスを設定して配信開始する。

これらが無効・不一致なら、タグがあっても表示されません。

## 任意のイベント・状態

管理画面で登録した名前だけを受け付けます。応募・予約・カート等、ページ閲覧だけではわからない情報に使います。

```js
// actionNamesにguide_downloadを登録した場合
window.JevPersonalization.track("guide_download");

// factNamesにregisteredを登録した場合
window.JevPersonalization.setFact("registered", false);
// 登録が完了したら
window.JevPersonalization.setFact("registered", true);
```

イベントの値は省略またはboolean/有限数値、状態はboolean/有限数値です。氏名・メール・フォームの入力値を渡すためのAPIではありません。

施策の除外factにregisteredを指定した場合、不明な値を「未登録」とみなしません。未完了はfalse、完了はtrueを連携します。

## いつ通信するか

同意と設定読込の後の初期判断、有効な閲覧時間への到達、ページ移動、追加イベント/状態変更等で判断します。同じ材料の重複要求を避け、待機中に定期的な判断APIのポーリングはしません。

表示時間のブラウザ内の更新と、外部への判断リクエストは別です。過去の有効な閲覧があれば、新しいページの初期判断にも使います。

## SPA・CSPと確認

SPAのページ移動やメタデータ変更も観測しますが、対象サイト固有のルーティング・JSON-LD・CMPで確認してください。

CSPではSDKのスクリプト、APIへの接続、表示画像、必要な独自JavaScriptモジュールの配信元を許可します。実サイトの既存ポリシーに合わせて限定的に設定してください。

Accessで保護された非公開Previewでは、同一Originの確認用ページだけに認証Cookieの引継ぎを明示します。通常のサイトへの組み込みではこの確認用オプションは不要で、別Originへ認証Cookieを送るものではありません。
