# Troubleshooting

## The order to check first

Checking in this order shows how far processing has got: [consent and the tag](./integration/sdk) → [site settings](./guides/sites) → [campaign status](./guides/campaigns) → [diagnostic panel](./guides/debugging).

| Symptom                                     | What to check                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The tag is in but nothing communicates      | SDK loading, consent, site ID, HTTPS, metadata sending, CSP                                            |
| No offer appears right after opening a page | The initial decision is made, but nothing is shown if valid views, time or conditions are insufficient |
| JSON comes back but nothing is displayed    | decision, campaign, display type, image loading, `reportShown` in custom code, CSP                     |
| It doesn't appear after being closed once   | `dismissed` in the browser and the display count limit                                                 |
| Settings can't be saved                     | Permissions, input limits, an outdated revision, the passkey re-authentication needed                  |
| Preview is rejected                         | Origin, permitted and excluded paths, campaign targets, display title, expiry                          |
| Another site isn't in the list              | The account's site membership                                                                          |

## You can't sign in with a passkey

Check the account by email and passkey. Open it at the correct HTTPS origin, and try another registered device or key. localhost and an IP address are not the same RP.

If you lost your device, use the [recovery steps](./guides/accounts#if-you-lose-your-device). There is no public recovery API that registers a new administrator with only an email address.

## You can't enter through Access

Use an allowed email address. If the email code doesn't arrive, check what you typed, your spam folder and the expiry, and resend it yourself if needed. A JevSense invitation alone doesn't add you to what Access allows.

If you still get a 403 JSON response after entering, the operator checks that Access's audience, issuer and the fixed AUTH_ORIGIN match. Use the fixed Preview URL, not an individual Deployment URL.

## Cloudflare authentication errors

CLOUDFLARE_API_TOKEN, each site's Jev API key and the encryption JEV_KEYRING are separate. Check the token's target account and operation permissions. A secret showing "ready" doesn't guarantee the real API's permission.

An account API token can't be verified with only the user-scoped `/user/tokens/verify`. Use `wrangler whoami` or the account verification API, and don't keep re-entering it just because of a 401.

For a 403 when you can't create an Access application, check the Access edit permission. For a 403 on a D1 operation, check the D1 edit permission and which database it connects to.

## Model or cost errors

| Reason               | What to do                                                                      |
| -------------------- | ------------------------------------------------------------------------------- |
| model_not_configured | Check the site's connection mode and API key, and the matching runtime secret   |
| model_error / 502    | Check the key, the model names available and the provider's status and response |
| budget_exhausted     | Check the cost budget per UTC day                                               |
| busy                 | Check the concurrency limit                                                     |
| rate_limited / 429   | Check whether operations or requests are concentrated, and wait a while         |

Preview's fixed stub can't be used to check real model failures. When you fix a key, also don't paste its value into logs or Issues.

## The production release stops

Check the 40-character reviewed commit, the current HEAD, unsaved changes and the deployment record in `data/deployments/preview.json`. If there is no record, recreate Preview. Don't force a deployment to production to bypass this check.

## If it still isn't resolved

Open an [Issue](https://github.com/manji6/jev-personalization/issues) with the steps to reproduce, your browser and OS, what you did, what you expected, and the error name with secrets removed. Don't share cookies, keys, tokens, form values or real browsing history.

## A site-only key can't be saved or isn't being called

If it says "the encryption key is not set", the environment administrator does the [initial setup of JEV_KEYRING](./operations/jev-keys). If it can't be decrypted, restore the matching old-generation key or register a new API key. It does not return to a shared key automatically. Also check the display conditions, consent and the site's connection mode.

If the usage count doesn't increase, note that it doesn't increase for fixed judgments in Preview/local-review or for forced previews. A call also doesn't start when conditions are unmet or the key isn't set. "Result unconfirmed" includes in progress, interrupted and failed-to-save results, and you can't conclude that Jev received it or billed it. Check billing with the provider.
