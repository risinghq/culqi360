# Database development

Culqi360 stores application state in PostgreSQL. Development databases are
disposable: a schema change rebuilds the database from the current schema.

## Initialize PostgreSQL

Run this once from the repository root after cloning:

```sh
bun run dev:infra:setup
```

The command initializes `.pgdata`, starts PostgreSQL long enough to create the
local `crm` database, then stops it. It does not create the application schema
or seed data.

Start development with:

```sh
bun run dev
```

The `dev` script of `apps/web` waits for PostgreSQL, initializes the current
schema, runs the installation seed (which loads development data and skips if
already initialized), then starts Vite.

## Reset the development database

With PostgreSQL running, run from the repository root:

```sh
bun run db:reset
```

It drops the database named in `WEB_DB_URL` (default `crm`), disconnecting its
clients, creates it empty, then initializes the current schema and runs the
seed. Restart the web server and the worker afterwards. The command refuses to
run with `NODE_ENV=production`. It never recreates the `postgres` maintenance
database.

To discard the whole local cluster instead, stop PostgreSQL, run
`bun run clean:db` (it removes `.pgdata` only) and repeat
`bun run dev:infra:setup`.

## Change the schema

Schema modules live in
[`schema/modules/`](../apps/web/src/server/platform/database/schema/modules/).
The table types of a module are in the `*.types.ts` file beside it
(`job-queues.ts` has none).
[`plan.ts`](../apps/web/src/server/platform/database/schema/plan.ts) orders the
modules.

After you change a schema module:

1. Update its matching database types.
2. Run `bun run db:reset`, which creates and seeds the new schema.
3. Restart the web server and the worker.
4. Run the focused tests for the changed domain.
5. Run `mise run check` for contract, generation, or cross-subsystem changes.

Schema initialization (the `migrate` script of `apps/web`, which `dev` and
`db:reset` run) builds an empty database and records a hash of the schema
modules. On a database that is already built it compares that hash with the
current code and stops with an error that points at `bun run db:reset` when they
differ. The running web server and worker do not check.

In production the `prepare` service runs the same initialization
([Deployment](deployment.md#application-stack)). A deployment that changes the
schema therefore stops at `prepare`, because there are no migrations and
`db:reset` refuses production.

## Workspaces

Every company that uses the CRM is a workspace. A workspace's users and data are
invisible to every other workspace. PostgreSQL enforces this with row-level
security, so a query that forgets a filter still returns only its own
workspace's rows.

### Tables

A table either has a `workspace_id` column or is listed in `GLOBAL_TABLES` in
[`schema/modules/tenancy.ts`](../apps/web/src/server/platform/database/schema/modules/tenancy.ts).
The schema build fails on a table that is neither, so a new table must be
classified when it is added. Global tables hold the workspace list, auth state
that is read before the workspace is known, shared reference data, the public
company registry and inbound webhooks.

`workspace_id` defaults to the `app.workspace_id` setting, so an insert inside a
workspace tags its row without naming the column. Every table with the column
has the `workspace_isolation` policy, which limits reads and writes to the
setting's workspace. Views run with `security_invoker`, so they apply the
policies of the tables they read. Tables in `WORKSPACE_TAGGED_TABLES` accept a
null `workspace_id` for platform rows, such as a sign-in attempt before the user
is known. Each of them lists its user columns. A row inserted with no workspace
takes the workspace of its first set user, so an audit event written by a login,
a password reset or a sweep still lands in that user's workspace.

A unique key on a workspace table includes `workspace_id`. Two workspaces can
hold the same RUC or DNI. An `ON CONFLICT` target must name the same columns as
the unique index, so it lists `workspace_id` too.

### Scopes

Each query runs in one of three scopes. The scope is held in `AsyncLocalStorage`
by
[`workspace-scope.ts`](../apps/web/src/server/platform/database/workspace-scope.ts).
When a pooled connection is reserved, it switches role and setting to match.

| Scope                    | Role                 | Sees                        |
| ------------------------ | -------------------- | --------------------------- |
| `runInWorkspace(id, fn)` | `work360_app`        | that workspace's rows       |
| `runAsPlatform(fn)`      | the connecting owner | every row; policies skipped |
| none                     | `work360_app`        | no workspace rows           |

The policies are enabled but not forced, so the table owner bypasses them. The
connection user must therefore own the schema, and the schema build makes it a
member of `work360_app` so it can switch role. `work360_app` has `SELECT`,
`INSERT`, `UPDATE` and `DELETE` on the tables that exist when the schema is
built. It has no rights on `schema_integrity`, which is created afterwards.

These boundaries choose a scope:

- **Requests.** The middleware resolves the session at platform scope, because
  sessions are global. A signed-in request then runs in the user's workspace. An
  anonymous request runs at platform scope: login, recovery, invite acceptance
  and webhooks find the workspace from what they read. Invite acceptance runs in
  the invite's workspace once it has found it. The framework renders pages and
  runs server functions inside the middleware's `next()`, so they inherit its
  scope.
- **Jobs.** The queue claims jobs at platform scope, across workspaces. A job
  from a workspace table then runs in that job's workspace. A job from a global
  table keeps the platform scope.
- **Sweeps and global jobs.** A sweep or a job from a global table that writes
  workspace rows runs each item in its owner's workspace. Reservation expiry
  lists lapsed leads across workspaces and expires each in its lead's workspace.
  The case timeout sweep does the same with due stages. An inbound WhatsApp
  message runs in the workspace of the user who owns the sender's address.
  Company enrichment is the exception: it updates every workspace's organization
  with the enriched RUC, because the registry is public.
- **Notification intents.** An event that a notification policy turns into an
  intent passes its workspace to the intent. A privileged login writes its alert
  at platform scope, and the alert still lands in the user's workspace.
- **Realtime.** The listeners start at platform scope, because one notification
  can fan out to streams in any workspace.
- **Seed.** The seed runs at platform scope. It creates the installation
  workspace, Culqi, and sets `app.workspace_id` for its transaction, so every
  seeded row is tagged with Culqi. Outside production it then creates a second
  workspace, Entel, with one user per role and Entel's case types, and switches
  the setting to it. That stage runs last.

### Modules

A workspace's `modules` column lists the product modules it bought. Row-level
security isolates the data; modules decide which features a workspace can reach.

| Module     | Covers                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| `culqi`    | Culqi's lead workflow: records, sales, quotations, fulfillment, inventory and commissions |
| `contacts` | contact search, data-source imports and search capacity                                   |

`contacts` is separate because contact data is personal data under Ley 29733: a
workspace receives it only when its contract covers it. Campaigns, cases, team
and administration need no module.

[`workspace-modules.ts`](../apps/web/src/domain/auth/access/workspace-modules.ts)
maps every permission to its module or to none. A member holds a permission when
the role grants it and the workspace has its module. The session carries the
modules, so the server's permission check, the route guard and the navigation
all apply the same rule. A server function that any role may call but only a
module may reach declares `access: { kind: "module" }`. A route does the same
with `module` in the route manifest. A member lands on the first page the
workspace and role allow.

### Roles

Each workspace owns its roles in `workspace_roles`. A role has a key, a name, a
kind and a permission list. The kind is one of the eight structural roles in
[`rbac.ts`](../apps/web/src/domain/auth/access/rbac.ts) and decides what code
reads from structure, such as which members carry an executive category. The
permissions decide what the role's members may do. A user's `role_id` references
a role of the user's own workspace, and `role` copies its kind.

A new workspace starts with one baseline role per kind, with the kind's baseline
permissions. A workspace may add roles of its own: Entel adds `validador`, a
supervisor kind. `workspace_role_assignables` lists the roles each role's
members may invite or move users into. The admin and superuser kinds assign
every role but a superuser one, so they have no list.

A member with `role:manage` edits the roles at `/settings/members?tab=roles`.
The server applies these rules:

- An editor grants only permissions they hold. A permission outside the
  workspace's modules is not shown, and an edit keeps it as it was.
- A new role takes any kind but superuser. It starts with its kind's baseline
  permissions, narrowed to those the creator holds.
- The key is a slug of the name at creation and never changes, because case
  stages name their owner role by key.
- The admin and superuser baseline roles are locked: nobody edits or deletes
  them, so a workspace always keeps a role that can manage roles.
- A role with members, or that owns a case stage, cannot be deleted.
- Assignable role ids must belong to the workspace, because foreign keys bypass
  row-level security.

The session reads the role on every request, so an edit applies to its members'
next request.

### Known limits

- An insert at platform scope into a workspace table must set `workspace_id`
  itself. The default reads an empty setting and the column is `NOT NULL`.
- Foreign key checks bypass row-level security. A workspace can reference a row
  id from another workspace if it knows the id. Ids are UUIDv7 and never shown
  across workspaces.
- `user_channel_addresses` keeps a global unique key, so one phone or email
  belongs to one user across all workspaces.

## End-to-end databases

The Playwright suite creates its own template and worker databases. It does not
use or reset the development `crm` database. See
[End-to-end testing](e2e-testing.md).

## Test databases

The web test setup acquires a disposable PostgreSQL server for local managed
test runs. Its state defaults to `.vitest-db/postgres-server` in the checkout.
`TEST_DB_SERVER_ROOT` is a test-only override for that managed-server root. Use
it when a test needs its server state in a temporary directory or needs multiple
processes to share one managed server. It does not configure the development
database or the CI service database.
