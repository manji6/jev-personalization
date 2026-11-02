# 管理画面・ヘルプの日本語レビュー

対象日：2026-11-02。管理画面・診断パネル等の表示文言7ファイルと、公開ヘルプ23ページを確認しました。利用者の依頼で[yomiyasu 2.5.0のSKILL.md](https://github.com/nanaism/yomiyasu/blob/29d67ccb05e370b5958d72920a9cd1aa829dee80/skills/yomiyasu/SKILL.md)を読み、同コミットの検査スクリプトを使いました。スキルのインストールや外部モデルへの送信は行っていません。

### 書き直した本文

修正済み本文は`src/admin/ui.js`、`src/debug-panel.js`、`public/admin.js`と`help/`の各ページに反映しました。原文は変更前コミット375d6c9とローカルの`data/japanese-review-20261102/original/`に保持しています。後者はGit対象外です。

### 変えたところ

- 操作画面の見出しを「アカウント設定」「サイト設定」「メンバー管理」等にし、何を操作する画面か分かるようにしました。
- 「ここに表示のイメージを確認できます」を「ここで表示のイメージを確認できます」に修正し、不自然な助詞と不要な読点を整理しました。
- ヘルプの配信開始手順で、確認ボタンを押してから配信開始する順番を文章で明記しました。入力欄・ボタンの正式名称は維持しています。
- 「画像が読み込めない画像のみオファー」の修飾関係を、「画像だけを表示するオファーで画像を読み込めない場合」に直しました。
- Jev利用記録の「上流」を「Jev側」にし、キー切り替えの説明は実際の選択肢名に合わせました。接続設定が使えない理由を未設定だけに限定しない表示にしました。

### 残したAIっぽいところ

「その人の、いまを。」等のログイン画面のブランドコピーは、紹介・宣伝部分として残しました。「チームに参加しませんか。」も招待の働きを保っています。操作画面の見出しとは区別しました。

「施策が効きそう」は避けるべき入力の引用例です。成果を保証する表現として使っていないため残しました。購入率・課金件数との違い、専用キーからの自動フォールバック禁止、localhostの例外など、意味のある否定や対比も維持しました。

手順で自然な「ます」の反復、項目を見分けるための太字・選択肢の区切り、条件節や別の主体の前の読点は残しました。ヘルプの「許可した版」の「版」はソフトウェアのバージョンを文字どおり指す定着した用法です。曖昧な比喩としては扱いませんでした。

### 事実の確かめ

以下の3点を原文と実装で照合しました。

| 対象                         | 実装上の根拠                                                          | 対応                                                                 |
| ---------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| キー切り替えの選択肢         | `src/admin/ui.js`の`jevModes`                                         | 説明中の略称を正式な選択肢名へ修正                                   |
| `model_not_configured`の範囲 | `src/site-jev.js`の`prepare`、`src/server.js`の`prepareModel`失敗処理 | 未設定以外に利用停止・復号不能等も含むため、表示とトラブル対応を修正 |
| HTTPSとHTTPの例外            | `src/url-policy.js`の`secureOrLoopback`                               | HTTPS Originの指定を説明し、localhostだけのHTTP例外を維持            |

ヘルプの見出しの数・順序・本文中の数値・コードフェンス内の例が変更前と一致することも確認しました。Jevへ送る質問、判定条件、登録済み施策、APIのエラー識別子は変更していません。

### 確認の記録

- 書き手: 決めていない／読み手: 管理画面とヘルプの利用者（指定）／場面: manual（推定）
- 実行した検査: lint、diff、資料との照合、最終稿の照合。機械検査だけに依存せず、全文と差分も確認しました。
- 実行しなかった検査: なし。`verify --replay`による検査スクリプトの再実行は通常の最終稿照合とは別で、今回は省略しました。
- 硬化の検査: 管理画面は候補3件、ヘルプは候補なし。管理画面の候補は「初回設定」「動作確認」「アカウント設定」への見出し変更であり、機能名として維持しました。
- 勢いの検査: 候補なし。
- 見直し候補: 管理画面は原文12件 → 最終稿9件。ヘルプ23ページの個別検査の合計は原文63件 → 最終稿34件。件数は点数ではない。増減は読みやすさの良し悪しを示さない。

管理画面の差分検査で残った意味変更候補2件は、キー切り替え説明中の「共通キー」「利用停止」を、画面にある正式名称に直した箇所です。選択肢の意味や切り替え動作は維持しました。ヘルプの意味変更候補は0件でした。これらの件数は意味の同一性や理解しやすさの合格判定ではありません。

結合したヘルプ原稿ではfrontmatterの見出しが本文として数えられるため、最終記録は23ページを個別に検査しました。管理画面はHTMLから本文とラベルを、JavaScriptから日本語の文字列を抽出した1つの確認用原稿を使っています。動的な値は`[表示値]`に置き換え、秘密情報や利用者の実データを含めていません。

| 対象                                       | 最終稿の候補数 | 最終の試行 | 実行ID                      |
| ------------------------------------------ | -------------- | ---------- | --------------------------- |
| help/getting-started/cloudflare.md         | 6              | 2          | `20261102T081422Z-1a57344a` |
| help/getting-started/node.md               | 0              | 1          | `20261102T081420Z-b75bfa17` |
| help/getting-started/preview-production.md | 4              | 1          | `20261102T081422Z-84bc0163` |
| help/getting-started/quickstart.md         | 1              | 2          | `20261102T081423Z-fc9becd0` |
| help/guides/accounts.md                    | 3              | 2          | `20261102T081420Z-1dde9a82` |
| help/guides/campaigns.md                   | 3              | 1          | `20261102T081422Z-ba5aa19a` |
| help/guides/debugging.md                   | 2              | 1          | `20261102T081424Z-2e9446d4` |
| help/guides/jev.md                         | 1              | 2          | `20261102T081423Z-79bef8e2` |
| help/guides/presentation.md                | 1              | 2          | `20261102T081423Z-4bf59940` |
| help/guides/sites.md                       | 2              | 1          | `20261102T081423Z-198f63c0` |
| help/guides/testing.md                     | 0              | 2          | `20261102T081423Z-3939b5d5` |
| help/index.md                              | 0              | 1          | `20261102T081423Z-acd83b58` |
| help/integration/data.md                   | 0              | 1          | `20261102T081425Z-aa46264e` |
| help/integration/sdk.md                    | 1              | 1          | `20261102T081424Z-4eb6cac4` |
| help/introduction/overview.md              | 1              | 1          | `20261102T081424Z-ef3d818a` |
| help/license.md                            | 0              | 2          | `20261102T081424Z-f3b428ba` |
| help/operations/help-site.md               | 1              | 1          | `20261102T081424Z-fda49fc4` |
| help/operations/jev-keys.md                | 0              | 1          | `20261102T081425Z-6bfb7ef7` |
| help/operations/maintenance.md             | 1              | 1          | `20261102T081424Z-5e89425b` |
| help/operations/security.md                | 4              | 1          | `20261102T081424Z-4f58cd8e` |
| help/reference/configuration.md            | 0              | 1          | `20261102T081424Z-5e228da4` |
| help/reference/faq.md                      | 2              | 1          | `20261102T081425Z-b9b007d6` |
| help/troubleshooting.md                    | 1              | 1          | `20261102T081425Z-e0639419` |
| data/japanese-review-20261102/ui-final.md  | 9              | 1          | `20261102T081424Z-68544509` |

最終の`verify`が返した状態行をそのまま記録します。23ページと管理画面原稿すべてで、検査記録とのハッシュ一致を確認しました。管理画面原稿の元になる7ファイルは、検査した最終稿のファイルとバイト単位で一致しています。

```text
yomiyasu-check: executed via=verify run=20261102T081422Z-1a57344a attempt=2 final=sha256:4f467af2148f mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081420Z-b75bfa17 attempt=1 final=sha256:c5533285b99a mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081422Z-84bc0163 attempt=1 final=sha256:add77250580f mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081423Z-fc9becd0 attempt=2 final=sha256:d5e256b40807 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081420Z-1dde9a82 attempt=2 final=sha256:69376f2259a5 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081422Z-ba5aa19a attempt=1 final=sha256:093ac7ee7d20 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-2e9446d4 attempt=1 final=sha256:b5a76794dd83 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081423Z-79bef8e2 attempt=2 final=sha256:7aec5a4a9431 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081423Z-4bf59940 attempt=2 final=sha256:469b767ac8ad mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081423Z-198f63c0 attempt=1 final=sha256:99d8313ba202 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081423Z-3939b5d5 attempt=2 final=sha256:b4ece83d4324 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081423Z-acd83b58 attempt=1 final=sha256:bc55e5cddbac mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081425Z-aa46264e attempt=1 final=sha256:976931abe857 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-4eb6cac4 attempt=1 final=sha256:f09ecf3b7a96 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-ef3d818a attempt=1 final=sha256:ae7d340979e1 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-f3b428ba attempt=2 final=sha256:9ce571a9cef8 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-fda49fc4 attempt=1 final=sha256:977998a88ac3 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081425Z-6bfb7ef7 attempt=1 final=sha256:e5343c2dda83 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-5e89425b attempt=1 final=sha256:ba141d849571 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-4f58cd8e attempt=1 final=sha256:89c9915632b4 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-5e228da4 attempt=1 final=sha256:e2baadbb99f8 mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081425Z-b9b007d6 attempt=1 final=sha256:00b18428bf0f mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081425Z-e0639419 attempt=1 final=sha256:5f2705992f8c mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=0 replay=skipped
yomiyasu-check: executed via=verify run=20261102T081424Z-68544509 attempt=1 final=sha256:212010656dfc mode=rewrite doc_type=manual checks=lint,diff,materials meaning_risk=2 replay=skipped
```

紹介記事・宣伝文と判断したので、ログイン画面の紹介部分では勢いのある書き方を残しました。

### 同時に修正した操作・表示の不具合

Superuserのサイト追加で、オリジンに末尾スラッシュを含むルートURLを入れると、パスキーの再認証後に入力エラーになるケースがありました。ルートURLをOriginへ変換し、経路・認証情報等は認証を始める前に入力欄で案内します。サーバーの検証や再認証要件は緩めていません。

再認証の確認画面が入力フォームを置き換え、キャンセルやエラー後に入力を修正できない問題も修正しました。フォームのDOMを退避・復元し、認証成功時だけ同じ要求を1回再送します。報告された実操作時の入力・通信記録は未取得なので、利用者のエラー原因をこのケースに断定はしていません。

パスキーの名前と補足は同じ行の薄い文字になっていました。名前を濃い文字、端末種別を次の行に分け、プロフィール操作との余白も設けました。

修正前に失敗し、修正後に成功するブラウザテストを3件追加しました。再認証キャンセル後の入力保持、認証後の登録、認証前のURL拒否、認証後の入力エラー時の復元、デスクトップと390px幅のパスキー表示を対象にしています。仮想CTAP2認証器による実際のパスキー署名を使い、実Jevへの問い合わせは行っていません。
