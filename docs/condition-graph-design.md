# ノード式の条件作成と実行

## 保存と既存施策

新規・編集ともにURL・Jev・AND・OR・最終結果をつなぐ画面を使う。campaign.conditionGraphに論理、同じグラフのlayoutに表示位置を保存する。既存施策は編集時にURL条件とJev質問を元の組み合わせでノードへ変換し、保存するまで公開設定を変更しない。質問ID・原文・旧定型・案内内容を保持する。配信ページ・最低履歴数・表示上限・除外fact・配信停止・優先順位はグラフの外で従来どおり適用する。

version:1、最大20ノード・40接続、Jev最大5問、URL最大5条件。サイト全体のJev最大10問も維持する。URL/Jevは入力なし、AND/ORは2入力以上、resultは1入力・出力なし。IDと接続の重複、参照不正、自分への線、循環を拒否する。下書きは未接続や未入力を保持できるが、配信開始時は全ノードを結果へ接続し、必須値を満たす。失敗時に既存の条件を空へ置き換えない。

Jevノードはguided（条件と共通offerから固定型へ変換）またはraw（原文）を持つ。サーバーがグラフからquestionsを作り、古いquestions/urlTargeting/judgmentとの二重評価をしない。既存方式のAPI入力は引き続き受け付ける。

## 実行

URLは除外キー適用後の現在/流入URLで確定判定する。URL情報や対象パラメータがない正の一致条件は不成立。Jevノードは問い合わせ前は未確定。ANDでfalseがあればfalse、ORでtrueがあればtrueとし、結果に必要な未確定のJevノードだけを1回の要求へまとめる。共有したノードは1問にまとめ、他の回答を質問文に参照させない。全体をURLだけで確定できればJevキー・予算を使わない。

回答後、各ノードはcampaign.thresholdを上回るかで真偽にする。必須の回答が欠ける・不正な場合は従来どおりモデルエラーとして保留。確率を掛け合わせない。優先順位と同順位のID順を維持し、確定一致した施策より下位の候補は問い合わせ不要として省く。

SDKの1ページ1要求とブラウザ内の履歴保存方式は変更しない。診断にはノードの値・問い合わせ対象と省略・最終結果を表示する。

## 編集・テスト・保護

ノード移動、端子のドラッグ/クリック接続、編集ダイアログ、削除ボタン・右クリック、元に戻す、整列、拡大縮小、グラフJSONのコピー/編集を用意する。編集者以上が操作し、閲覧者は読み取りだけ。

条件テストは認証・所属・CSRFを検証する専用APIで、実行エンジンと同じ評価関数を使う。送る値はグラフ、除外済みの現在/流入URL、判定値、しきい値だけ。サーバーでもURLのorigin/許可経路と除外を検査する。履歴・利用記録・費用枠・管理設定を保存せず、Jevへ送らない。変更後の古いテスト結果は消し、再テストを促す。実配信の同意・履歴数・表示制限の試験とは区別する。

Previewでコード・DB分離・保護とテストを確認し、ユーザーの承認済みフローに従ってProductionへ反映する。配備前のTime Travel復旧位置と設定・資格情報の版を記録する。追加の破壊的DB移行は行わない。

## リリースと互換性

既存施策は保存するまで旧形式のまま動作し、新旧形式の施策を同じサイトへ置ける。SDKタグ・通信頻度・URL除外の契約は変更しない。conditionGraphを持つ施策がある場合のalgorithmVersionはcondition-graph-v1。追加のD1スキーマ移行はない。

旧版の厳密なsiteSchemaはconditionGraphを受け付けない。ノード形式を保存した後のコードの切り戻し先は、ノード形式を読める版を使う。任意の混在AND/ORを旧方式へ自動で平坦化しない。障害時は対象施策の停止、互換版での修正、必要に応じたCloudflare内の復旧位置を使う手順を検討し、DB全体の上書きで他の管理操作を消さない。

## 保存オブジェクト

campaign.conditionGraphの例（流入コード、または関心が一致すれば対象）。layoutを省略すると既定値は空オブジェクトになり、編集画面が初期配置する。

```json
{
  "version": 1,
  "offer": "吸汗速乾ポロシャツの特集を案内する",
  "nodes": [
    {
      "id": "entry",
      "kind": "url",
      "source": "entry",
      "field": "query",
      "key": "cid",
      "operator": "contains",
      "value": "runner"
    },
    {
      "id": "interest",
      "kind": "jev",
      "key": "polo_interest",
      "format": "guided",
      "condition": "吸汗速乾ポロシャツに関心がある"
    },
    { "id": "either", "kind": "or" },
    { "id": "result", "kind": "result" }
  ],
  "edges": [
    { "id": "e1", "from": "entry", "to": "either" },
    { "id": "e2", "from": "interest", "to": "either" },
    { "id": "e3", "from": "either", "to": "result" }
  ],
  "layout": {}
}
```

| フィールド            | 契約                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| version               | 1のみ                                                                                                                     |
| offer                 | 全guidedノード共通の案内内容。400文字以内。raw原文には挿入しない                                                          |
| nodes[].id / Jevのkey | 英数字・ハイフン・アンダースコア、1〜64文字。prototype / constructor / \_\_proto\_\_を拒否。keyは質問IDで、ノードIDとは別 |
| URLのsource / field   | entryまたはcurrent、queryまたはurl                                                                                        |
| URLのoperator         | contains / equals / prefix。queryはデコード済みの各値に照合し、複数値のうち1つで一致すれば成立                            |
| URLのkey / value      | keyは100文字以内、valueは300文字以内。公開時はvalue必須、queryならkeyも必須                                               |
| Jevのformat           | guidedはcondition（400文字以内）、rawはinstructions（1000文字以内）を使う                                                 |
| JevのtemplateVersion  | 復元時にcurrent / legacyを保持。未指定は現在の定型                                                                        |
| edges                 | id / from / to。方向は条件から組み合わせ、組み合わせから結果へ。出力の分岐・共有ノードを許す                              |
| layout                | ノードIDごとのx / y。有限の数、xは0〜5000、yは0〜10000                                                                    |

管理APIは、questionsをグラフから再生成し、旧urlTargetingを空、decisionModeをJevノードの有無からmodel / rulesにする。判定時はconditionGraphを正とし、旧questionsやcombinationを再度ANDすることはない。旧形式の施策には従来の評価を適用する。

## 条件テストAPI

POST /admin/api/v2/sites/:siteId/condition-test。Cookieセッション、X-JevSense-CSRF、当該サイトの編集者以上が必要。

要求はgraph、currentUrl、entryUrl、threshold（0.5〜0.99）、probabilitiesを持つ。probabilitiesはノードIDから0〜1の数値またはnullへの対応表で最大5件。質問IDではない。未指定はnullとして扱い、不明なノードIDは拒否する。

応答は次を返す。APIはURLを取りに行かず、入力したURLを条件と照合する。

| フィールド     | 意味                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| valid / issues | 配信開始条件としての接続・入力の妥当性と問題一覧。未完成でも安全な下書きなら検査結果を返す |
| value          | true / false / null。nullは未確定で、falseとは別                                           |
| values         | ノードIDごとのtrue / false / null                                                          |
| active         | 結果ノードへつながったノードID                                                             |
| needed         | サンプル値を入れた後でも結論に必要な未確定ノード                                           |
| requiredJev    | URLで確定させた後、実際の配信でJevへ質問する必要があるノード。仮の判定値では減らさない     |
| input          | 除外キー適用後の現在/流入URL・pathとしきい値                                               |
| questions      | グラフから導いた質問プレビュー。問い合わせを実行した記録ではない                           |

未認証は401、CSRF・権限・所属の不備は403、構造不正・URL範囲外・不明な判定値IDは400。公開中の設定は読み取りだけで、下書き・管理監査・モデル利用記録を増やさない。認証セッションの通常の有効性確認は行う。
