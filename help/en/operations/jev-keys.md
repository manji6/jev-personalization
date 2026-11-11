# Operating site-only keys safely

These are steps for the people who operate the environment. Site admins use [Jev connection in the admin console](../guides/jev). The **encryption key** you create here is different from the **API key** issued by Jev.

## How it is stored

API keys are encrypted with AES-256-GCM and saved in a dedicated table. The encryption key isn't put in the database. It is held in a Cloudflare runtime secret or Node.js's secrets mechanism. The ciphertext is verified against the site ID and the update version, so it can't be copied to another site and used there.

This protects the values from someone who can only read the database. It doesn't isolate them from an operator who controls both the app process and the encryption key. The admin console shows only whether a key is set, and there is no API that reveals a key.

## Generate the encryption key (first time only)

In an environment where JEV_KEYRING is already set, don't overwrite it with a new value. If you lose it, saved API keys can no longer be decrypted. Use separate encryption keys for Preview and Production.

```sh
npm run jev:keyring:create -- data/preview-jev-keyring.json
```

This creates a JSON file containing the encryption key with permission 0600. The value isn't printed to the terminal, and an existing file isn't overwritten. `data/` is excluded from Git. Don't add the file to Git, chat or published artifacts. On Windows or another file system, also check the ACLs.

## Cloudflare Preview

First check only the setting names, and if JEV_KEYRING already exists, keep using it.

```sh
npx wrangler preview secret list --name YOUR-PREVIEW-NAME --json
```

Only if it isn't set, pass the newly generated JSON for Preview through standard input.

```sh
npx wrangler preview secret put JEV_KEYRING --name YOUR-PREVIEW-NAME < data/preview-jev-keyring.json
```

Don't put it in ordinary vars, build variables or the shared Previews base. This project doesn't inherit the base. Preview's own secrets are kept in the next deployment too. Then do the [Preview deployment](../getting-started/preview-production), and confirm that the encryption setup notice disappears from "Jev connection" in the admin console.

## Cloudflare Production

**After the production update is approved**, check the setting names, and only if it isn't set, generate and register a separate file.

```sh
npx wrangler secret list
npm run jev:keyring:create -- data/production-jev-keyring.json
npx wrangler secret put JEV_KEYRING < data/production-jev-keyring.json
```

The generation and registration above are for the first time. If an existing JEV_KEYRING is present, don't run them, and use the key rotation steps instead. Changing a secret is itself an update of the runtime environment. Don't do it on Production before checking.

A Production deployment needs ADMIN_TOKEN and JEV_KEYRING. Register the API key issued by Jev in each site's "Jev connection". The environment's JEV_API_KEY is not used. There is also no process that copies a shared key to each site automatically. A site that ran on a shared key holds its Jev-based judgments until its own key is registered.

## Node.js

```sh
npm run jev:keyring:create -- data/node-jev-keyring.json
```

Set the absolute path of that file in the runtime environment's `JEV_KEYRING_FILE`, and make it readable only by the user running Node.js. Persist it, restrict access separately from the database, and back it up. You can also pass the JSON from a secrets management service as the runtime `JEV_KEYRING`. If both are set, JEV_KEYRING takes precedence.

`npm run review` automatically generates `.jev-keyring.json` next to the review database the first time and reuses it. Because judgment is fixed, saving an API key doesn't send anything to the real Jev.

## Backups and key rotation

A database backup alone can't restore API keys. Back up the matching encryption key separately in a secrets management service, and limit who can read it. Don't rely on being able to read a Cloudflare secret's value back later.

1. In a safe environment, generate a new 32-byte random value and add it to `keys` in the existing JSON under a new generation name. Keep the old generation's value.
2. Change `active` to the new generation and update JEV_KEYRING. Don't delete the old generation yet.
3. On each site, keep "Site-only key" selected and save with the API key field empty. This re-encrypts the current value with the new generation.
4. After confirming every site has been migrated and the backup recovery policy, delete old generations you no longer need. Keep any keys needed for past backups safely, separately.

The JSON has `active` and `keys`. Each key is 32 bytes in base64url (without the trailing `=`), a generation name is up to 40 characters of letters, digits, underscores and hyphens, and there can be up to 10 generations. This is independent of updating AUTH_SECRET.

## Leaks, loss and rollback

If an API key is suspected, reissue or revoke it on the Jev side and replace it from the site's "Jev connection". Deleting it in the app alone does not revoke the provider's key.

If the encryption key leaks, also check access to the database, and if necessary revoke and reissue all stored sites' API keys with the provider. Simply updating the encryption key can't invalidate old ciphertext that has already leaked.

If you lose the encryption key, restore from the matching backup, or register a new encryption key and each site's API key again. It never switches to a shared key automatically to keep processing.

After setting site-only keys or a usage stop, rolling back to only old code that predates this support could call with a shared key. Prioritize deploying a fix on a version that supports it, and if a rollback is needed, consider the code, database and encryption key together at the same recovery point.
