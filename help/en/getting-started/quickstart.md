# Start here: try it locally

## If you were invited to the admin console

You don't need to install anything. Open the invitation link and register a display name and a passkey. Continue to [sign-in and accounts](../guides/accounts).

## If you are installing it yourself

The recommended setup is to run on Cloudflare. It is easiest to follow if you first try the screens locally, then install into your own environment with [Cloudflare setup](./cloudflare).

## Prerequisites for the local check

- Node.js 24 or later, and npm
- Git
- A browser and device that support passkeys. Start with Chrome or Edge.

Get the repository.

```sh
git clone https://github.com/manji6/jev-personalization.git
cd jev-personalization
npm ci
npm run review
```

## Register

Open **`http://localhost:4174/admin`**. Use this `localhost` spelling, not `127.0.0.1`.

Enter a display name, an email address and the local-only token below, then register a passkey.

```text
local-review-only-not-a-production-token
```

::: warning Never use this value in production
This is a publicly known value for local checks. For the production ADMIN_TOKEN, set an independent random value created with a secrets management service or similar.
:::

## What really works

Passkey authentication, saving to the database, site permissions, campaign editing and offer display are all real. Only the Jev judgment is a stub, `local-review-stub`, which returns a score of 0.95. It does not connect to Jev or Cloudflare, and nothing is published.

A demo site is already registered. Create a campaign and, for the real-page preview URL, specify **`http://localhost:4174/demo`**. Set the target paths to all permitted pages or `/demo`.

## Restart and stop

Press Ctrl+C to stop. Accounts and settings stay in `data/review.sqlite` and are available after a restart. Don't delete this database if you need the history.

To start from a clean state, stop the server and point `REVIEW_DB_PATH` at a new database. You can also set `REVIEW_PORT` to change the port.

A passkey is bound to its origin and RP ID. Don't switch from localhost to another domain or an IP address partway through your check.

## Open Help from the admin console

The sign-in screen has "View Help and manual (「ヘルプ・マニュアルを見る」)". After signing in, you can open it from any screen through "Help and manual (「ヘルプ・マニュアル」)" in the side menu. On a smartphone it is the book icon. The home screen also has links to the setup and campaign-creation steps.

Help opens in a separate tab, so you can check it while keeping the settings you are in the middle of entering.
