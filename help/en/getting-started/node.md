# Run on Node.js

You need Node.js 24 or later, a persistent disk and an HTTPS reverse proxy. The Node.js version is intended for single-process operation.

## Install

```sh
git clone https://github.com/manji6/jev-personalization.git
cd jev-personalization
npm ci
npm run build
mkdir -p data
cp config/example.json data/config.json
```

The sample metadata sending and the sample campaign are disabled. Review your own site's information before enabling them.

## Runtime settings

| Name                           | Description                                                          |
| ------------------------------ | -------------------------------------------------------------------- |
| AUTH_MODE                      | `passkey`                                                            |
| AUTH_ORIGIN                    | The exact HTTPS origin of the admin console                          |
| AUTH_SECRET                    | An independent random secret of at least 32 characters               |
| ADMIN_TOKEN                    | A random value of at least 32 characters for first superuser setup   |
| JEV_KEYRING / JEV_KEYRING_FILE | The keystore that encrypts site keys, or the path to its secret file |
| CONFIG_PATH                    | Initial data. Defaults to `data/config.json`                         |
| ADMIN_DB_PATH                  | Admin database. Defaults to `data/administration.sqlite`             |
| HOST / PORT                    | Default `127.0.0.1` / `3000`                                         |

We recommend passing secrets through your production environment's secrets management service. If you use a local `.env`, don't assume a plain `npm start` loads it automatically. Load it explicitly, for example with Node.js `--env-file`. Don't add `.env` to Git.

```sh
# When the variables are provided by the runtime environment
npm start

# When explicitly using a local .env that is excluded from Git
node --env-file=.env src/app.js
```

To use site-only keys, follow the [encryption key steps](../operations/jev-keys) and set `JEV_KEYRING`, or set `JEV_KEYRING_FILE` to the absolute path of the dedicated JSON file. JEV_KEYRING takes precedence, and you manage it independently of AUTH_SECRET. Persist both the database and the encryption key.

## HTTPS and the proxy

Make AUTH_ORIGIN match the URL opened in the browser, and keep the Host header intact in the proxy. This setup does not infer and allow an RP ID from the Host or Origin automatically.

Only the development `http://localhost` is an exception. You can't use a public host over plain HTTP. For a quick check, use the [local trial](./quickstart).

## First registration

Open `/admin` and register a passkey with a display name, an email address and ADMIN_TOKEN. The first user is the superuser. After registering, also prepare a spare passkey and recovery codes.

Once administration has started, updates go to SQLite. Rewriting the initial JSON does not overwrite an existing admin database.

## Persistence and backups

Keep the SQLite file and its WAL on the same persistent volume. Back up while stopped, or use a consistent method that SQLite supports. Protect not only the settings but also the database of administrators and credentials.

The Node.js cost counter lives in the process and resets on restart. Sharing a cost limit across multiple instances is not provided.

The Dockerfile is an example deployment that runs as non-root. Assign a persistent volume that the runtime user can write to at `/app/data`, and set the same runtime variables.
