# パスキー / Workers互換性実験

2026-10-31。管理画面v2の技術検討用。**本番の認証機能ではない。** 本番DB・Secret・サイトのユーザー情報を使わず、合成ユーザーとChromiumの仮想認証器だけで実行した。

## 結果

[result.json](result.json)に実行記録を保存。@simplewebauthn/server 14.0.3をブラウザ向けESMへバンドルし、Miniflare/workerdで実行。nodejs_compatは使っていない。

- ES256、residentKey required、userVerification required、attestation noneの登録が成功。
- ブラウザで作成した署名付きassertionの検証が成功。
- challengeの再利用、想定外Origin、想定外RP ID、UVのない署名付き応答は拒否。

これはCloudflareランタイムとライブラリの互換性を調べる狭い実験。実機・同期パスキー・別ブラウザ・ES256以外・本番DBの並列処理・Cookie・招待・復旧・権限管理は検証していない。

最初の試行ではプロジェクト外の一時ディレクトリをバンドルの配置先にしたため、Miniflareのモジュールパス解決で起動できなかった。出力をdist/auth-spike/へ移すと実行できた。認証ライブラリの非対応とは扱わない。

## 再実行

リポジトリ直下で、既存の開発依存とPlaywright Chromiumを用意する。ライブラリは本番依存へ加えず、一時ディレクトリに固定バージョンを入れる。

```sh
npm install --prefix /tmp/jevsense-auth-spike --ignore-scripts --no-audit --no-fund --package-lock=false @simplewebauthn/server@14.0.3
JEVSENSE_AUTH_SPIKE_MODULES=/tmp/jevsense-auth-spike/node_modules node experiments/auth-v2/run.mjs
```

生成バンドルはdist配下、観測結果はresult.json。外部の認証サーバーへアクセスせず、公開先へデプロイしない。worker.jsのchallengeやcredentialは単一のメモリ変数で、実装の保存方式として使ってはいけない。
