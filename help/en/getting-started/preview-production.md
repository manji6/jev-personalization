# From Preview to Production

When you update the system, deploy to a preview environment, verify it there, and release only the approved commit to production. This is a system-update procedure, separate from a campaign's "draft → start delivery".

## How Preview and production differ

| Item                       | Preview                           | Production                             |
| -------------------------- | --------------------------------- | -------------------------------------- |
| URL and passkeys           | A fixed preview origin            | The production origin                  |
| Database, users, campaigns | The preview D1                    | The production D1                      |
| Durable Objects            | Preview only                      | Production only                        |
| Access                     | Limited to approved people        | Follows your operating policy          |
| Jev                        | A fixed stub in the initial setup | Real judgments with the production key |

If you use site-only Jev keys, keep the [JEV_KEYRING](../operations/jev-keys) for Preview and Production independent. Don't copy ciphertext, keys or usage records into production.

This uses Cloudflare Worker Previews. A Version URL shares production resources, so it can't replace this separated check.

## 1. Build the preview version

Commit your settings and code, and make the tests pass.

```sh
npm run check
npm run test:cloudflare
npm run test:browser
npm run cf:preview
```

The script verifies that the database, migration target, rate-limit namespace and authentication settings differ from production. It migrates and deploys to Preview only, and stores the commit and Deployment ID in `data/deployments/preview.json`.

Use the fixed Preview URL. Don't use an individual Deployment URL as the place to register passkeys.

## 2. Check it

- Enter through Access, and confirm passkey registration and signing in again.
- Switch between sites and check permissions.
- Check saving a campaign draft, starting delivery and stopping it.
- Check the display and shared design on the same-origin demo page.
- Note the preview commit shown at the top of the screen.

Don't treat the stub's 0.95 as a measurement from Jev or as campaign effect. Check the real model separately, after setting a key and a cost budget.

An SDK on an external site can't talk without an authentication cookie to an API that Access protects entirely. The current private Preview uses the same-origin demo. For testing with an external site, design the protection scope of the admin console and the delivery API separately.

## 3. Release the approved version to production

Run this **only after the check is finished and the production release has been explicitly approved**.

```sh
npm run cf:release -- --reviewed-commit FULL_40_CHARACTER_COMMIT_SHA
```

It compares the hashes of HEAD, the working tree, the deployment record and the Production settings, and stops if there are unchecked or uncommitted changes. Specify the full 40-character SHA, not a short 7-character one.

The preview database, accounts, passkeys and campaigns are not copied to production. Production uses its own data and is registered for the first time on the production origin.

## Notes when updating

This repository's CI only runs checks. `cf:deploy` also requires the same check and stops without a deployment record. If Cloudflare Builds or another external CI runs `wrangler deploy` directly, it skips this check, so turn off automatic production deployment and unify on manual releases. Changing the code alone does not disconnect an external service's integration.

In a new working environment with no deployment record, redeploy the same commit to Preview to recreate the record and the check. If you test several branches at once, separate the Preview name, D1, origin and migration settings for each.

For production backups and rollback, see [updates and recovery](../operations/maintenance).
