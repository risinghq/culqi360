# safeapp cutover

Entel runs on safeapp, a Laravel application on MariaDB. The cutover copies
safeapp's users, tiendas, clientes and cases into a new work360 workspace. It
runs once. safeapp's campaign data (`datos`, `asignacion_datos`) and call log
(`llamada`) are not imported yet.

The code is in
[`server/cutover/safeapp`](../apps/web/src/server/cutover/safeapp). The source
reader, the plan and the loader are separate, so the plan is tested without
either database.

## Running it

`SAFEAPP_DATABASE_URL` names the safeapp database as a `mysql://` URL. The
target is the database `WEB_DB_URL` names, as for every other command.

```sh
cd apps/web
SAFEAPP_DATABASE_URL=mysql://... bun run cutover:safeapp
SAFEAPP_DATABASE_URL=mysql://... bun run cutover:safeapp --write
```

Without `--write` the command is a dry run: it reads safeapp, builds the plan
and prints it. `--workspace NAME` names the new workspace and defaults to
`Entel`. `cutover:safeapp:prod` reads the environment instead of `.env`.

The report prints counts, the safeapp ids of skipped rows and the number of
values it could not resolve. It never prints a value, because the rows hold
Entel's customers' personal data.

The reader takes one consistent, read-only snapshot, so safeapp can stay in use
while it runs. The loader writes everything in one transaction. It refuses with
`cutover_workspace_exists` when a workspace already has the id or name, and with
`cutover_user_exists` when a username or email is already taken, so a second run
writes nothing.

## What it maps

| safeapp                          | work360                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `tienda`                         | A branch.                                                        |
| `usuario`, `acceso`, `rol`       | A user with one role (below).                                    |
| `asignacion_tienda`              | The user's branch: the active assignment (`estado` 0) wins.      |
| `cliente`                        | An organization, one per RUC.                                    |
| `cartera`, `producto`            | The choices of the mobile order's cartera and the fixed product. |
| `nc_movil`, `nc_fija`, `quiebre` | Cases of Entel's three case types, with each stage's status.     |

- **Roles.** safeapp grants screens, and work360 gives a user one role. The
  strongest grant decides: `ADMINISTRADOR` or `usuarios.manage` makes an admin,
  `liquidacion.gestionar` a sales manager, any `.back` grant back office, any
  `.validar` grant a supervisor, and anything else an executive.
- **Users.** `personal` splits into names and two surnames, the last two words.
  A user without a usable email, or whose email an earlier user holds, gets
  `<username>@safeapp.invalid`. A user with no tienda joins a branch named "Sin
  tienda", which exists only when one is needed.
- **Passwords.** safeapp's password hashes are not copied. Every user gets an
  unusable password and must set one: through the password reset email, or
  through the reset link an admin generates on the member's settings page
  (`/settings/members/:id`) for an address that receives no mail.
- **Catalogs.** A catalog holds the active entries and every entry a case still
  names, so an imported case keeps a value its form offers.
- **Stages.** Each stage takes its status, writer and date from safeapp's
  columns. A stage nobody worked keeps no writer and the filing date. safeapp's
  dates are Lima days, stored as Lima midnight. A missing date (`0000-00-00`)
  and an unset reference (`0`) become empty.

## What it skips

A skipped row is reported with its safeapp id and reason:

- `invalid_ruc`: a cliente whose RUC is not 11 digits.
- `username_missing`, `username_repeated`: a user without a username, or one
  whose username, ignoring case, an earlier user holds.
- `owner_missing`, `organization_missing`: a case whose user or cliente did not
  map.
- `unknown_status:<stage>`: a case whose stage status is not one of the preset's
  statuses.

A value it cannot resolve is counted, not skipped: a writer or tienda safeapp no
longer has is left empty, and a choice outside the preset's list is kept as
written.
