# Deployment

Two Docker Compose stacks deploy Culqi360 on a Dokploy host behind Traefik. The
application stack and the engine stack run separately and meet on the external
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
