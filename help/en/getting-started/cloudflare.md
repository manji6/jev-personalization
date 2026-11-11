# Set up on Cloudflare

Workers run the admin console, SDK and API. D1 holds the admin data, and Durable Objects hold Jev's cost counter. This setup does not store visitors' behavior history in D1.

## What you need

| Item                                    | Purpose                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| A Cloudflare account                    | Workers, D1, Durable Objects and Access                                        |
| The GitHub code and Node.js 24 or later | Build and deployment                                                           |
| A Cloudflare API token                  | Permissions to update Workers, edit D1 and configure Access on your account    |
| A Jev API key                           | Real judgments in production. Not needed while you check Preview with the stub |
| A stable admin console origin           | Where passkeys are registered. HTTPS workers.dev works too                     |

If you are using Access for the first time, also complete the initial Cloudflare Zero Trust setup. Check pricing, available features and limits against your own plan.

## 1. Get the code

```sh
git clone https://github.com/manji6/jev-personalization.git
cd jev-personalization
npm ci
```

::: warning Don't deploy the repository's settings as they are
`wrangler.json` contains the developer's Worker, account, database and Access settings. Replace the items below with your own. Database IDs are not secrets, but using another environment's ID points you at the wrong target.
:::

## 2. Create production and preview D1 databases

Create two, in the Cloudflare dashboard or with the CLI.

```sh
npx wrangler d1 create YOUR-PRODUCTION-DATABASE
npx wrangler d1 create YOUR-PREVIEW-DATABASE
```

Use different database IDs for production and preview. Don't copy data from the preview database into production.

## 3. Replace the Wrangler settings

Set at least the following.

| File or location                               | What to set                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `account_id` / `name` in wrangler.json         | Your account ID and Worker name                                             |
| The database in `d1_databases`                 | The production database ID and name                                         |
| `vars.AUTH_MODE`                               | `passkey`                                                                   |
| `vars.AUTH_ORIGIN`                             | The production admin console origin, without a trailing slash               |
| `previews.vars.AUTH_ORIGIN`                    | The origin of the fixed preview URL                                         |
| `previews.vars.DEPLOYMENT_TIER`                | `preview`                                                                   |
| `previews.vars.PREVIEW_MODEL_MODE`             | `stub` at first                                                             |
| The database in `previews.d1_databases`        | The preview database ID and name                                            |
| `previews.durable_objects.bindings`            | MODEL_BUDGET / ModelBudget. Uses the class in the same Worker               |
| `previews.ratelimits`                          | A `namespace_id` different from production                                  |
| PREVIEW_DB in wrangler.preview-migrations.json | The same ID and name as the preview database above, and the same account_id |

`npm run cf:configure -- <D1 UUID> <Worker name>` is a helper that only updates the production-side ID and Worker name. Edit `account_id`, the origin, Preview and the migration settings separately.

The current deployment script derives the Preview name from the host name of the fixed AUTH_ORIGIN. For example, with `review-YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev`, the name is `review`.

## 4. Protect Preview with Access

If you use an existing Worker, continue from that Worker's settings screen. If the parent resource for a new Worker doesn't exist yet, you can first create Preview in a **closed state**. Leave `PREVIEW_ACCESS_AUD` and `PREVIEW_ACCESS_DOMAIN` empty and run the following. Because the Worker has no entry rule, it returns no page.

```sh
npm run build:cloudflare
npx wrangler preview --name YOUR-PREVIEW-NAME --ignore-base-config
```

In a Cloudflare Access application, protect **only the Preview** of your Worker. Limit the allowed emails and make sure Production is not included.

Set the application's audience in `previews.vars.PREVIEW_ACCESS_AUD`, and your team's authentication domain (`TEAM.cloudflareaccess.com`) in `PREVIEW_ACCESS_DOMAIN`. Take both from your actual Access settings.

The Worker also verifies the JWT's signature, issuer, audience and expiry. Without these settings it returns no page. If the Preview URL is disabled on an existing Worker, enable routing, but don't deploy unverified app code to production just for that.

## 5. Register the Preview secret

The Preview AUTH_SECRET is an independent random value of at least 32 characters. Don't store it in plain variables or in Git.

For the first deployment, you can put only AUTH_SECRET into a local JSON file with restricted permissions and pass it through `PREVIEW_SECRETS_FILE`. For example, name the file `.dev.vars.preview-secrets.json`, which is excluded from Git. Replace the value with an independent random value of at least 32 characters that you generated yourself.

```json
{
  "AUTH_SECRET": "<a secret value you generated yourself>"
}
```

```sh
# First-time example in a POSIX shell. Commit the settings and code first
PREVIEW_SECRETS_FILE=.dev.vars.preview-secrets.json npm run cf:preview
```

In PowerShell, set the file path in `$env:PREVIEW_SECRETS_FILE` and run the same command. Don't write the value in a command argument or a plain variable, and don't add the file to Git. After registration you can safely delete the local secrets file you no longer need.

For an existing Preview, you can also register it interactively.

```sh
npx wrangler preview secret put AUTH_SECRET --name YOUR-PREVIEW-NAME
```

::: info The shared base is not inherited automatically
This project's `cf:preview` uses `--ignore-base-config`. Don't assume a secret placed only in the shared Previews base will be used automatically. The Preview's own secrets are kept when you update it.
:::

## 6. Deploy to Preview and check

Commit your settings, empty the working tree, then run:

```sh
npm run check
npm run test:cloudflare
npm run test:browser
npm run cf:preview
```

This migrates the preview database, registers the initial site and deploys to Preview. Enter through Access, then register a display name and a passkey. The first user of the preview environment is fixed to the email authenticated by Access.

## 7. Set the production secrets

Production needs `ADMIN_TOKEN`, a runtime secret for first-time registration, and `JEV_KEYRING`, which encrypts each site's API key. Follow [initial setup of the encryption key](../operations/jev-keys), and generate and register them only if no existing value is present. These are separate from the API token used to operate Cloudflare.

```sh
npx wrangler secret put ADMIN_TOKEN
# Register JEV_KEYRING with the initial setup steps above.
```

After deploying to production, register the Jev API key from "Jev connection (「Jev連携」)" for each site in the admin console. A shared JEV_API_KEY is not needed.

If the production AUTH_SECRET doesn't exist yet, an independent value is generated and set during the explicit production release step. Don't copy the Preview value. An existing environment's value is never overwritten.

## 8. Release to production after checking

```sh
npm run cf:release -- --reviewed-commit FULL_40_CHARACTER_COMMIT_SHA
```

Production migration and deployment run only when the conditions in [From Preview to Production](./preview-production) are met. On the production `/admin`, register the first superuser and a passkey with the initial ADMIN_TOKEN. From then on, sign in with the passkey.

Finally, check the site settings, the [shared tag](../integration/sdk) and normal decisions and display.

## Use a custom domain for the admin console

After connecting your custom domain to the Worker in Cloudflare, also set that HTTPS origin in the plain variable `AUTH_ORIGIN`. Example: `https://jevsense.example.com`. Don't add a trailing `/` or `/admin`. The admin console opens at `https://jevsense.example.com/admin`. Reflect the setting in the repository's `wrangler.json` too, so the next deployment doesn't revert it.

If the admin console is opened over HTTP or through another connected domain, you are redirected to the configured official HTTPS URL. Authentication POST requests from another origin are not accepted. The `/sdk.js` and `/v1/*` endpoints used by SDK tags already placed on pages continue to work.

If you change the admin domain after registering passkeys, secure your recovery codes first. A passkey is bound to its domain, so you need to register again on the new domain. The initial `ADMIN_TOKEN` cannot recreate an already registered account. Use the [recovery steps](../guides/accounts) for the existing account.
