import { defineConfig, type DefaultTheme } from "vitepress";

// 計測タグは公開ビルド（help:publish）だけに入れる。dev・テスト用ビルドでは送信しない。
const tracking = process.env.HELP_TRACKING === "on";
const GTM_ID = "GTM-PLPR5WN9";
const gtmHead = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`;
const gtmBody = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

type Labels = {
  groups: [string, string, string, string, string];
  items: Record<string, string>;
};

// メニューは日本語・英語で同じ構造を共有する。リンクは prefix（"" または "/en"）で切り替える。
function sidebar(prefix: string, t: Labels): DefaultTheme.Sidebar {
  const link = (path: string, key: string) => ({
    text: t.items[key],
    link: prefix + path,
  });
  return [
    {
      text: t.groups[0],
      items: [
        link("/introduction/overview", "overview"),
        link("/reference/faq", "faq"),
      ],
    },
    {
      text: t.groups[1],
      items: [
        link("/getting-started/quickstart", "quickstart"),
        link("/getting-started/cloudflare", "cloudflare"),
        link("/getting-started/preview-production", "previewProduction"),
        link("/getting-started/node", "node"),
      ],
    },
    {
      text: t.groups[2],
      items: [
        link("/guides/accounts", "accounts"),
        link("/guides/sites", "sites"),
        link("/guides/campaigns", "campaigns"),
        link("/guides/presentation", "presentation"),
        link("/guides/testing", "testing"),
        link("/guides/debugging", "debugging"),
        link("/guides/jev", "jev"),
      ],
    },
    {
      text: t.groups[3],
      items: [
        link("/integration/sdk", "sdk"),
        link("/integration/data", "data"),
      ],
    },
    {
      text: t.groups[4],
      items: [
        link("/operations/security", "security"),
        link("/operations/jev-keys", "jevKeys"),
        link("/operations/maintenance", "maintenance"),
        link("/reference/configuration", "configuration"),
        link("/troubleshooting", "troubleshooting"),
        link("/operations/help-site", "helpSite"),
        link("/license", "license"),
      ],
    },
  ];
}

const ja: Labels = {
  groups: [
    "JevSenseを知る",
    "導入する",
    "管理画面を使う",
    "サイトへ組み込む",
    "運用・リファレンス",
  ],
  items: {
    overview: "JevSenseとは",
    faq: "よくある質問",
    quickstart: "最初に読む・ローカル体験",
    cloudflare: "Cloudflareへのセットアップ",
    previewProduction: "PreviewからProductionへ",
    node: "Node.jsで動かす",
    accounts: "ログイン・アカウント・招待",
    sites: "サイト設定と共通デザイン",
    campaigns: "施策を作成・配信する",
    presentation: "表示形式と独自JavaScript",
    testing: "プレビューと動作確認",
    debugging: "診断パネルを読む",
    jev: "Jev接続・利用状況",
    sdk: "SDKタグと追加連携",
    data: "取得・送信されるデータ",
    security: "セキュリティと秘密情報",
    jevKeys: "サイト専用キーの安全な運用",
    maintenance: "更新・バックアップ・復旧",
    configuration: "設定と上限",
    troubleshooting: "トラブルシューティング",
    helpSite: "ヘルプサイトの保守",
    license: "ライセンス",
  },
};

const en: Labels = {
  groups: [
    "About JevSense",
    "Get started",
    "Use the admin console",
    "Add it to your site",
    "Operations and reference",
  ],
  items: {
    overview: "What is JevSense?",
    faq: "FAQ",
    quickstart: "Start here: try it locally",
    cloudflare: "Set up on Cloudflare",
    previewProduction: "From Preview to Production",
    node: "Run on Node.js",
    accounts: "Sign-in, accounts and invitations",
    sites: "Site settings and shared design",
    campaigns: "Create and deliver campaigns",
    presentation: "Display types and custom JavaScript",
    testing: "Preview and verification",
    debugging: "Read the diagnostic panel",
    jev: "Jev connection and usage",
    sdk: "SDK tag and optional integrations",
    data: "Data collected and sent",
    security: "Security and secrets",
    jevKeys: "Operating site-only keys safely",
    maintenance: "Updates, backups and recovery",
    configuration: "Settings and limits",
    troubleshooting: "Troubleshooting",
    helpSite: "Maintaining the Help site",
    license: "License",
  },
};

export default defineConfig({
  title: "JevSense",
  base: process.env.HELP_BASE || "/jev-personalization/",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", href: "/jev-personalization/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#245b44" }],
    ...(tracking
      ? ([["script", {}, gtmHead]] as [string, object, string][])
      : []),
  ],
  transformHtml(code) {
    return tracking ? code.replace(/<body[^>]*>/, (m) => m + gtmBody) : code;
  },
  locales: {
    root: {
      label: "日本語",
      lang: "ja-JP",
      title: "JevSense ヘルプ",
      description:
        "JevSenseの導入、施策の作成、表示デザイン、パスキー認証、動作確認と運用のガイド。",
      themeConfig: {
        nav: [
          { text: "はじめる", link: "/getting-started/quickstart" },
          { text: "使い方", link: "/guides/campaigns" },
          { text: "トラブル対応", link: "/troubleshooting" },
          {
            text: "GitHub",
            link: "https://github.com/manji6/jev-personalization",
          },
        ],
        sidebar: sidebar("", ja),
        outline: { level: [2, 3], label: "このページの内容" },
        docFooter: { prev: "前のページ", next: "次のページ" },
        sidebarMenuLabel: "メニュー",
        returnToTopLabel: "ページ上部へ",
        langMenuLabel: "言語を切り替える",
        darkModeSwitchLabel: "カラーテーマ",
        lightModeSwitchTitle: "明るい表示に切り替える",
        darkModeSwitchTitle: "暗い表示に切り替える",
        lastUpdated: {
          text: "最終更新",
          formatOptions: { dateStyle: "medium" },
        },
        editLink: {
          pattern:
            "https://github.com/manji6/jev-personalization/edit/feature/site-jev-management/help/:path",
          text: "このページの編集を提案",
        },
        footer: {
          message: "パスキー対応版を対象とするヘルプです。",
          copyright: "© 2026 JevSense contributors · MIT License",
        },
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      title: "JevSense Help",
      description:
        "Guides for setting up JevSense, creating campaigns, designing displays, passkey sign-in, verification and operations.",
      themeConfig: {
        nav: [
          { text: "Get started", link: "/en/getting-started/quickstart" },
          { text: "Guides", link: "/en/guides/campaigns" },
          { text: "Troubleshooting", link: "/en/troubleshooting" },
          {
            text: "GitHub",
            link: "https://github.com/manji6/jev-personalization",
          },
        ],
        sidebar: sidebar("/en", en),
        outline: { level: [2, 3], label: "On this page" },
        docFooter: { prev: "Previous page", next: "Next page" },
        sidebarMenuLabel: "Menu",
        returnToTopLabel: "Back to top",
        langMenuLabel: "Change language",
        darkModeSwitchLabel: "Appearance",
        lightModeSwitchTitle: "Switch to light theme",
        darkModeSwitchTitle: "Switch to dark theme",
        lastUpdated: {
          text: "Last updated",
          formatOptions: { dateStyle: "medium" },
        },
        editLink: {
          pattern:
            "https://github.com/manji6/jev-personalization/edit/feature/site-jev-management/help/:path",
          text: "Suggest an edit to this page",
        },
        footer: {
          message: "This Help covers the passkey-enabled version.",
          copyright: "© 2026 JevSense contributors · MIT License",
        },
      },
    },
  },
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "JevSense",
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
        locales: {
          root: {
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
          en: {
            translations: {
              button: {
                buttonText: "Search Help",
                buttonAriaLabel: "Search Help",
              },
              modal: {
                noResultsText: "No results found",
                resetButtonTitle: "Clear search",
                footer: {
                  selectText: "to select",
                  navigateText: "to navigate",
                  closeText: "to close",
                },
              },
            },
          },
        },
      },
    },
  },
  ignoreDeadLinks: false,
});
