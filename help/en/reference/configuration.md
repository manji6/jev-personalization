# Settings and limits

## Runtime settings

| Name                           | Meaning                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| AUTH_MODE                      | `passkey` to use the new admin console                        |
| AUTH_ORIGIN                    | The fixed admin console origin. HTTPS, no trailing slash      |
| AUTH_SECRET                    | A signing secret per environment. At least 32 characters      |
| ADMIN_TOKEN                    | For first superuser registration. At least 32 characters      |
| JEV_KEYRING / JEV_KEYRING_FILE | The keystore for encrypting site API keys, or its secret file |
| JEV_MODEL                      | The model name used for initial setup                         |
| DAILY_REQUEST_BUDGET           | The daily execution limit (UTC) used for initial setup        |
| MAX_CONCURRENT                 | The concurrency used for initial setup                        |
| DEPLOYMENT_TIER                | Set `preview` for Preview only                                |
| PREVIEW_MODEL_MODE             | Use test values with the Preview `stub`                       |
| PREVIEW_ACCESS_DOMAIN / AUD    | The issuer and the application that Access trusts             |

The model and budget are carried into the admin database at first registration. After that, the place to set them is the superuser's "JevSense management (「JevSense管理」)". You don't override the database values by rewriting only environment variables.

A site-only key needs the runtime secret `JEV_KEYRING`. Only Node.js can instead read the file given by `JEV_KEYRING_FILE`. For details, see [operating the encryption key](../operations/jev-keys).

## Main admin console settings

| Setting                              | Range                                            |
| ------------------------------------ | ------------------------------------------------ |
| Site origins                         | Up to 10                                         |
| Sites                                | Up to 100                                        |
| Campaigns in the live settings       | Up to 5 per site                                 |
| Questions                            | Up to 5 per campaign, up to 10 per site in total |
| Presented content and each condition | Up to 400 characters each                        |
| Judgment threshold                   | 0.5 to 0.99. A visitor must be strictly above    |
| Display count                        | 1 to 10                                          |
| Priority                             | 0 to 100                                         |
| Valid viewing time                   | 1000 to 300000 milliseconds                      |
| Valid past views required            | 0 to 10                                          |
| Saved drafts                         | Up to 20 per site                                |
| Versions in History                  | Latest 10 per campaign                           |
| Passkeys                             | Up to 10 per user                                |

## Input and communication limits

The request body is limited to 64 KiB. Valid browsing history is up to 50 entries, optional events up to 30 and confirmed states up to 20 items. Even within those limits, the length of page information may reach the body size limit.

The design uses only permitted names, paths and types, and treats unknown values and invalid probabilities as not being a target.

## Expiry

| Item                                       | Expiry and handling                |
| ------------------------------------------ | ---------------------------------- |
| Admin session                              | 30 minutes idle, 12 hours absolute |
| Re-authentication for important operations | Within 5 minutes                   |
| Invitation link                            | 24 hours, one use                  |
| Superuser recovery link                    | 5 minutes, one use                 |
| Authentication challenge                   | 5 minutes, one use                 |
| Real-page check ticket                     | 5 minutes, one use                 |
| Fetch authority for checking custom code   | 30 seconds, one use                |
| Diagnostic authorization                   | Up to 15 minutes                   |

## Rough roles of the APIs

The public SDK uses `/v1/sites/:siteId`, `/v1/decision` and so on. Administrator sign-in is `/auth/*`, and per-site administration is `/admin/api/v2/*`.

Don't distribute admin cookies or admin tokens to the SDK. For the actual schema and concurrency control, see the [detailed design](https://github.com/manji6/jev-personalization/blob/main/docs/admin-v2-design.md).

## Jev connection and record limits

A site's connection mode is one of three: shared, site-only and stopped. A site-only API key is 8 to 4096 printable ASCII characters with no spaces. The encryption keystore uses up to 10 generations of 32 bytes each. Usage records are shown for up to 90 days by UTC day, with the latest 100 entries. API keys and usage records are for site admins and superusers only.

URL exclusion keys are the per-site `excludedQueryKeys` (up to 50, each up to 100 characters). A campaign's `minimumHistory` is 0 to 10, and the site setting is used if it is unspecified. URL conditions are up to 5 in `urlTargeting.conditions`. The decision method is `decisionMode: model | rules`. The new SDK separates the current and entry pages with `protocolVersion: 2`, and keeps page URLs up to 4,096 characters.
