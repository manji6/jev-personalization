# Maintaining the Help site

This Help builds the Markdown in the repository's `help/` with VitePress and publishes it on GitHub Pages. It is a static site that uses no app server or API keys. The generator, VitePress 2.0.0-alpha.21, is pinned in the dependency lock. When you update it, run the link check and check it in a browser.

## Edit

Suggest a change from the edit link at the bottom of each page, or edit the Markdown locally. Screenshots are in `help/public/images/`, and the menus are in `help/.vitepress/config.mts`.

The Japanese pages live directly under `help/`, and the English pages live under `help/en/` with the same file names. When you change a page, update both. Screenshots are shared between the two languages and are in Japanese. Because the admin console is currently Japanese only, English pages show screen labels as an English translation followed by the original Japanese label in 「 」.

```sh
npm ci
npm run help:dev
```

Open the URL shown locally in a browser. The development server is limited to 127.0.0.1.

## Build and check

```sh
npm run help:build
npm run help:preview
```

A broken internal link makes the build fail. Also check search, the menu, code copying and smartphone width, in both languages.

## Publish to GitHub Pages

Commit your changes and empty the working tree before running this. You need permission to push to GitHub and to configure Pages.

```sh
npm run help:publish
```

Only the built files are updated on `gh-pages`, with a push that keeps the normal history. Only the first time, set the Pages source to the root of `gh-pages`. If the existing Pages settings differ, it stops without replacing them on its own.

The published address is **https://manji6.github.io/jev-personalization/**, and the English version is at **https://manji6.github.io/jev-personalization/en/**. It takes a little time for GitHub to finish building and serving.

### If only the first activation returns 403

If the GitHub connection lacks permission to edit Pages settings, the file push may succeed but only the first activation can fail. A repository administrator opens [Settings → Pages](https://github.com/manji6/jev-personalization/settings/pages), chooses "Deploy from a branch" for Source, "gh-pages" for Branch and "/ (root)" for the folder, and saves. You don't need to paste an API key or an extra token into the text.

Once the source is set, you can update Help by pushing to `gh-pages` from then on. To update only the published files without using the Pages settings API, use `npm run help:publish -- --files-only`. Check the display at the published URL before treating the publication as complete.

## How this differs from releasing the app to production

Publishing Help updates only `gh-pages`. It doesn't deploy code to the app's Production or migrate the database.

If you change the app's reviewed commit, deploy it to Preview separately and move to Production after checking. Don't treat publishing Help as meaning the app has been released to production.
