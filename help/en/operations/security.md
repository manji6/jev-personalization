# Security and secrets

## Tell the keys apart

| Name                 | Purpose                                        | Where it is stored                                                 |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| CLOUDFLARE_API_TOKEN | Operations such as deployment, D1 and Access   | Secrets management of your workstation or CI                       |
| JEV_KEYRING          | Encrypting and decrypting site-only API keys   | A runtime secret for the Worker or Node.js                         |
| ADMIN_TOKEN          | The first superuser registration in production | A runtime secret. Not used for normal sign-in after the first time |
| AUTH_SECRET          | Signing diagnostic authorization               | An independent runtime secret for each environment                 |

**The token for operating Cloudflare, the encryption key and each site's Jev API key are all separate.** Don't put the values in Git, HTML, JavaScript, plain variables or Issues. The admin console doesn't show the values either.

On Cloudflare, register JEV_KEYRING and AUTH_SECRET as **secrets**, not as ordinary text variables. Jev API keys are entered in each site's admin console. If you display the whole configuration through the API, plaintext variables may appear in the output. Limit your checks to names, types and similar.

A site-only Jev API key is saved [encrypted in a dedicated table](./jev-keys) and decrypted with the runtime secret `JEV_KEYRING`. There is no API that shows a key again. Only site admins and superusers handle settings and usage records. Rotate it independently of AUTH_SECRET.

## Passkeys and admin sessions

The admin cookie is Secure, HttpOnly and SameSite=Lax, and is never placed in the browser's Web Storage or in a URL. The server keeps a hash of a random session value.

Writes verify the origin and CSRF, and the server also checks site permissions. Disabling a user or changing a permission is applied in the API, not just hidden on the screen.

## Protecting Preview

A Preview URL is public by default. Limit access to your team with Cloudflare Access, and have the Worker also verify the Access JWT. Keep D1, secrets and the cost counter separate from production.

The permissions of the API token used to configure Access do not automatically grant the signed-in user any JevSense permissions.

## Custom code

It runs with the same privileges as your site. Limit who can register code to admins, and review and check it. variables are also visible in the browser.

## External sending and logs

Check the target pages' metadata, URL paths and optional integrations, and put consent and a privacy notice in place. Check Jev's retention terms, pricing and so on with the provider.

Make sure proxies and APM don't record request bodies, cookies, Authorization, diagnostic authorization or browsing history. A CORS origin can usually be spoofed by an ordinary HTTP client, so don't rely on it as authentication against cost attacks.

Only the start, result, model, latency and key type of real Jev calls are stored in the [usage records](../guides/jev). State, questions, answers and visitor information are not recorded. An interruption between the start and saving the result is recorded as "unconfirmed" and is not used as the basis for a billed amount.

## Cost and availability

Set a daily limit and a concurrency limit. Failed real-model requests also count toward the daily limit, and there is no automatic retry. The in-app limits alone don't guarantee a strict cap on what you are billed.

The IP limit on Workers is an approximate limit per location. The Node.js counter lives in the process and resets on restart.

## If you suspect a leak

Reissue or revoke the key with the relevant provider, and update the secret in every environment that uses it. For authentication problems, also disable users and end sessions.

Changing AUTH_SECRET invalidates diagnostic authorization, but that alone doesn't end every database-backed admin session. Revoke sessions explicitly if needed.

## Checking page information fetching

The authority for a fetching check is limited to the administrator's sign-in, the site, and the page's origin and path. A connection can be started only once, and it expires in 5 minutes. The string that carries the authority is not placed in a URL, and the admin console and the target page verify the sender when handing it over. After sign-out or a permission change, no new connection can be made. A check already connected also ends on the end operation, consent withdrawal, a URL change or expiry.

The server keeps a hash of the short-lived checking authority and the draft settings. The full HTML of the real page, the whole JSON-LD and the fetched result are not stored, and the check result goes directly from the target page to the admin console. The admin console also validates it as untrusted input and shows it as text. Don't include secrets in the keys, conditions or prefixes you set.
