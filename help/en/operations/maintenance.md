# Updates, backups and recovery

## Update basics

Commit your implementation, deploy to Preview after testing, then release to production by specifying the commit you finished checking. See the [update commands](../getting-started/preview-production).

Changes to campaigns and the shared design are made in the admin console. Saving a draft, starting delivery of a campaign and deploying the whole system are separate operations.

## Backups

On Cloudflare, note the D1 Time Travel restore point and the code commit, and export if needed.

```sh
npx wrangler d1 export DB --remote --output backup.sql
```

The admin database contains not only settings but also emails, passkey public keys, sessions, invitations and so on. Restrict access to backups.

On Node.js, keep the SQLite file and the WAL consistent. Back up while stopped or use a SQLite-aware backup method, and secure a persistent disk.

There is no feature to back up or restore visitors' behavior history from the server.

## Migrating from the old admin-token method

An additional migration creates the admin tables. It doesn't delete the existing app_config, and when the first superuser registration succeeds, it copies the latest sites at that point. Site and campaign IDs and existing questions are kept.

After the switch, admin_sites is used and updates to the old app_config are frozen. You can't get into the normal admin APIs with the old token. Removing AUTH_MODE doesn't return to the old method automatically.

## Rolling back

Reverting only the code to an older version may be inconsistent with the new settings in the database. Prioritize updating to a fix that keeps the additional migrations.

To go back to the past, align the code and database restore points during maintenance and check which admin operations would be lost. Don't truncate questions without notice to convert them to an old format.

## Account recovery

Normally you use a spare passkey, recovery codes or a superuser's time-limited recovery link. See [accounts](../guides/accounts).

If every superuser loses their credentials, an environment operator who can operate the database responds, after verifying identity and taking a backup. There is no public back door that retakes an existing account with ADMIN_TOKEN. The final steps for operators are in the [repository's migration and recovery guide](https://github.com/manji6/jev-personalization/blob/main/docs/admin-v2-setup.md).

## Health checks

`/health` only confirms that the process responds. It doesn't guarantee Jev's balance, correct audience judgments or the validity of every secret. In Preview, the entrance is also protected by Access.

During a model failure, congestion or a cost limit, it continues without showing offers. Check that you can operate the target site itself, and check the reasons in the diagnostic panel.

## Site-only Jev keys and usage records

Backups also contain the ciphertext of API keys and the usage records. Protect and store the matching encryption key separately from the database. Old records are deleted during normal use and viewing, but backup retention is managed separately. For updating, losing and rolling back the encryption key, see the [dedicated steps](./jev-keys). Rolling back to only code that predates this support could ignore site-only keys or a stop and use a shared key.
