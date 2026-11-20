# Deployment

Culqi360 deploys two ways: as a Cloudflare Worker (see [Workers](#workers)), and
as two Docker Compose stacks on a Dokploy host behind Traefik. The application
stack and the engine stack run separately and meet on the external
`dokploy-network` network.

| Stack       | Compose file                                  | Image file                                  | Environment template                                                        |
| ----------- | --------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Application | [`compose.app.yml`](../compose.app.yml)       | [`Dockerfile`](../Dockerfile)               | [`ops/deployment/app.env.example`](../ops/deployment/app.env.example)       |
| Engine      | [`compose.engine.yml`](../compose.engine.yml) | [`Dockerfile.engine`](../Dockerfile.engine) | [`ops/deployment/engine.env.example`](../ops/deployment/engine.env.example) |

Copy each template to `.env` in the stack's working directory. The web
[configuration](web-configuration.md) describes the application values. The
[engine readme](../crates/engine/readme.md) describes the engine values.

## Application stack

The stack runs two services from the application image. Both mount
`$APP_DATA_PATH/uploads` at `/var/lib/crm-web`. The SQLite stores live in its
`data` directory and uploads in its `documents` directory.

- `prepare` runs once. It runs `bun run provision:prod`, which creates the
  stores and the installation without demo data. `web` waits for it to complete.
- `web` serves the application with `bun run start` on port 3000. Traefik routes
  `APP_DOMAIN` to it. The same process runs queue and maintenance work.

The template sets three names that must be unique per deployment:
`DEPLOYMENT_NAME`, `APP_DOMAIN`, and `APP_DATA_PATH`. The compose file fixes the
production values for `HOST`, `PORT`, `WEB_DATA_DIR`, `ENGINE_CONNECT_MODE`,
`ENGINE_URL`, and `WEB_UPLOADS_ROOT`, so the `.env` file does not set them.

Sentry settings are in [web configuration](web-configuration.md#observability).

## Engine stack

The `engine` service runs `engine` as uid 10001 with ingest enabled. It stores
its databases and ingest uploads under `$ENGINE_DATA_PATH`. That directory must
be writable by uid 10001 and must already hold `contacts.sqlite`. Publish it
with the [pipeline](../crates/pipeline/readme.md), then restart the engine. The
engine creates `leads.sqlite` and `ingest.sqlite` when they are missing.

The container binds `0.0.0.0` with `ENGINE_CONNECT_MODE=internal`. It is
reachable only as `crm-engine` on `dokploy-network`.

`ENGINE_HMAC_KEYS_JSON` holds one key per application deployment. The
[engine readme](../crates/engine/readme.md#configuration) describes how each
deployment pairs with its key.

The engine healthcheck calls `GET /health`. The `web` healthcheck requests `/`
and fails on a 5xx response.

## Workers

[`apps/web/wrangler.jsonc`](../apps/web/wrangler.jsonc) deploys the Worker
`work360` to the custom domain `work360.rising.sh`, with its three Durable
Object classes, the R2 bucket `work360-files` for files, and the plain
variables. The bucket must exist before the first deploy:

```sh
cd apps/web
bunx wrangler r2 bucket create work360-files
bun run build:workers
bunx wrangler deploy -c dist/worker/wrangler.json
```

The secrets `SESSION_SECRET`, `TOTP_ENCRYPTION_KEY`, `RECOVERY_CODE_PEPPER`,
`ENGINE_HMAC_SECRET` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` are set once with
`bunx wrangler secret bulk FILE -c dist/worker/wrangler.json`. Keep a copy of
`TOTP_ENCRYPTION_KEY`: without it, no enrolled TOTP secret can be decrypted.
`NOTIFICATION_ROUTES=email:log` keeps the deploy from sending mail or WhatsApp.

The assets binding serves pages and static files without running the Worker, so
the middleware's security headers never reach them. The Workers build writes
[`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/)
into `dist/client` from the same `securityHeaders`, plus a year of immutable
caching for the content-hashed `/assets/*`. It also writes `.assetsignore`,
which keeps the bundle analyzer's report out of the upload. The browser Sentry
DSN in the CSP is read at build, so build with the production `VITE_SENTRY_DSN`.

### Stores

On Cloudflare Workers each store is a SQLite Durable Object. Provisioning runs
on Bun into local files, then copies them into the deployed objects.
`provision:prod` creates the installation without demo data and sets the
password of every installation user to `INSTALLATION_PASSWORD`:

```sh
cd apps/web
INSTALLATION_PASSWORD=... WEB_DATA_DIR=./provisioned bun run provision:prod
bunx wrangler secret put LOAD_TOKEN -c dist/worker/wrangler.json
LOAD_TOKEN=... WEB_DATA_DIR=./provisioned bun run stores:push https://HOST
bunx wrangler secret delete LOAD_TOKEN -c dist/worker/wrangler.json
```

`stores:push` prints the rows each store loaded:

```text
registry: {"rows":34}
platform: {"rows":111}
workspaces/803c1384-bb0d-53b7-83b8-96fed8c601c9: {"rows":133}
```

It sends each store to `PUT /api/admin/stores/<name>`, reads it back with `GET`,
and fails unless the deployed store matches the local file byte for byte. The
routes answer 404 without the `LOAD_TOKEN` secret, so delete it after the push.

A load refuses a dump from another schema version and a dump that would drop a
row the object already holds, so it never overwrites a store in use. Pushing the
same files again changes nothing.
