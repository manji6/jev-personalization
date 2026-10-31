import { defineConfig } from "vitepress";
export default defineConfig({
  title: "JevSense ヘルプ",
  description:
    "JevSenseの導入、施策の作成、表示デザイン、パスキー認証、動作確認と運用のガイド。",
  lang: "ja-JP",
  base: process.env.HELP_BASE || "/jev-personalization/",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", href: "/jev-personalization/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#245b44" }],
  ],
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "JevSense",
    nav: [
      { text: "はじめる", link: "/getting-started/quickstart" },
      { text: "使い方", link: "/guides/campaigns" },
      { text: "トラブル対応", link: "/troubleshooting" },
      { text: "GitHub", link: "https://github.com/manji6/jev-personalization" },
    ],
    sidebar: [
      {
        text: "JevSenseを知る",
        items: [
          { text: "JevSenseとは", link: "/introduction/overview" },
          { text: "よくある質問", link: "/reference/faq" },
        ],
      },
      {
        text: "導入する",
        items: [
          {
            text: "最初に読む・ローカル体験",
            link: "/getting-started/quickstart",
          },
          {
            text: "Cloudflareへのセットアップ",
            link: "/getting-started/cloudflare",
          },
          {
            text: "PreviewからProductionへ",
            link: "/getting-started/preview-production",
          },
          { text: "Node.jsで動かす", link: "/getting-started/node" },
        ],
      },
      {
        text: "管理画面を使う",
        items: [
          { text: "ログイン・アカウント・招待", link: "/guides/accounts" },
          { text: "サイト設定と共通デザイン", link: "/guides/sites" },
          { text: "施策を作成・配信する", link: "/guides/campaigns" },
          { text: "表示形式と独自JavaScript", link: "/guides/presentation" },
          { text: "プレビューと動作確認", link: "/guides/testing" },
          { text: "診断パネルを読む", link: "/guides/debugging" },
        ],
      },
      {
        text: "サイトへ組み込む",
        items: [
          { text: "SDKタグと追加連携", link: "/integration/sdk" },
          { text: "取得・送信されるデータ", link: "/integration/data" },
        ],
      },
      {
        text: "運用・リファレンス",
        items: [
          { text: "セキュリティと秘密情報", link: "/operations/security" },
          { text: "更新・バックアップ・復旧", link: "/operations/maintenance" },
          { text: "設定と上限", link: "/reference/configuration" },
          { text: "トラブルシューティング", link: "/troubleshooting" },
          { text: "ヘルプサイトの保守", link: "/operations/help-site" },
          { text: "ライセンス", link: "/license" },
        ],
      },
    ],
    outline: { level: [2, 3], label: "このページの内容" },
    docFooter: { prev: "前のページ", next: "次のページ" },
    sidebarMenuLabel: "メニュー",
    returnToTopLabel: "ページ上部へ",
    darkModeSwitchLabel: "カラーテーマ",
    lightModeSwitchTitle: "明るい表示に切り替える",
    darkModeSwitchTitle: "暗い表示に切り替える",
    lastUpdated: { text: "最終更新", formatOptions: { dateStyle: "medium" } },
    editLink: {
      pattern:
        "https://github.com/manji6/jev-personalization/edit/feature/admin-v2-implementation/help/:path",
      text: "このページの編集を提案",
    },
    footer: {
      message: "パスキー対応版を対象とするヘルプです。",
      copyright: "© 2026 JevSense contributors · MIT License",
    },
    search: {
      provider: "local",
      options: {
        miniSearch: {
          options: {
            tokenize(text) {
              return Array.from(
                new Intl.Segmenter("ja", { granularity: "word" }).segment(text),
              )
                .filter((v) => v.isWordLike)
                .map((v) => v.segment.toLowerCase());
            },
          },
        },
        translations: {
          button: {
            buttonText: "ヘルプを検索",
            buttonAriaLabel: "ヘルプを検索",
          },
          modal: {
            noResultsText: "見つかりませんでした",
            resetButtonTitle: "検索をクリア",
            footer: {
              selectText: "選択",
              navigateText: "移動",
              closeText: "閉じる",
            },
          },
        },
      },
    },
  },
  ignoreDeadLinks: false,
});
