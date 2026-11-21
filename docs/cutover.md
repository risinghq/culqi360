# Imports

Three workspaces on work360.rising.sh started from another application's data.
Each import ran once, in November 2026, and its code was removed after the run.
The code is in git history: `git log -- apps/web/src/server/cutover`. This page
records what each import kept and what it left behind, so the data reads
correctly.

| Workspace      | Source                                           |
| -------------- | ------------------------------------------------ |
| Entel          | safeapp, Entel's Laravel application on MariaDB  |
| Entel Empresas | CRM Entel, Entel's sales CRM on Postgres         |
| Culqi          | the old culqi360 deploy, work360's first version |

Every import ran the same way: it pulled production's stores with `stores:pull`,
wrote into the local copy, and sent the changed stores back with `stores:push`
(see [deployment](deployment.md#stores)). Its reports printed counts and source
ids only, never a value, because the rows hold the businesses' customers' data.

## Shared rules

- **Passwords.** No password hash was copied. Every imported user has an
  unusable password and sets one through the password reset email, or through
  the reset link an admin generates on the member's settings page
  (`/settings/members/:id`) for an address that receives no mail.
- **Usernames.** A username is unique across workspaces, and the three sources
  share people. CRM Entel's usernames carry the prefix `crm.` and culqi360's
  `culqi.`; safeapp's keep their own.
- **Sessions, tokens and files.** Sessions, login history, invites, recovery
  codes and TOTP factors stayed behind, and so did every uploaded file.

## Entel, from safeapp

| safeapp                          | work360                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `tienda`                         | A branch.                                                        |
| `usuario`, `acceso`, `rol`       | A user with one role (below).                                    |
| `asignacion_tienda`              | The user's branch: the active assignment (`estado` 0) wins.      |
| `cliente`                        | An organization, one per RUC.                                    |
| `cartera`, `producto`            | The choices of the mobile order's cartera and the fixed product. |
| `nc_movil`, `nc_fija`, `quiebre` | Cases of Entel's three case types, with each stage's status.     |
| `datos`                          | A campaign record, in a campaign per `tipo_data`.                |
| `asignacion_datos`               | Who held each record, and when.                                  |
| `respuesta`                      | An [outcome](activities.md#outcomes) of its `tipo`'s channel.    |
| `llamada`                        | An activity with source `import` and its respuesta's outcome.    |

- **Roles.** safeapp grants screens, and work360 gives a user one role. The
  strongest grant decided: `ADMINISTRADOR` or `usuarios.manage` made an admin,
  `liquidacion.gestionar` a sales manager, any `.back` grant back office, any
  `.validar` grant Entel's `validador` role, and anything else an executive.
- **Users.** `personal` split into names and two surnames, the last two words. A
  user without a usable email, or whose email an earlier user held, got
  `<username>@safeapp.invalid`. A user with no tienda joined the branch "Sin
  tienda". A deleted safeapp user whose history the import kept is an inactive
  account.
- **Catalogs.** A catalog holds the active entries and every entry a case still
  names, so an imported case keeps a value its form offers.
- **Stages.** Each stage took its status, writer and date from safeapp's
  columns. A stage nobody worked keeps no writer and the filing date. safeapp's
  dates are Lima days, stored as Lima midnight. A missing date (`0000-00-00`)
  and an unset reference (`0`) became empty.
- **Campaigns.** `tipo_data` (MOVIL or FIJA) names the [campaign](campaigns.md)
  and `origen` is the record's segment. `zonal`, `nodo` and the `q_` line counts
  are the record's facts. A dato with `estado` 1 is worked, dated by its latest
  call. Two datos of one RUC in one campaign and segment merged into one record.
- **Holds.** An active `asignacion_datos` row (`activa` 1) is an open hold. Any
  other was released on `fecha_liberacion`, or on the day it was assigned when
  that was missing. When two open rows held one record, the later one kept it.
- **Outcomes.** safeapp's respuestas replaced the baseline outcomes. A respuesta
  of `tipo` VISITA is a visit outcome, and any other a call outcome.
  `contactabilidad`, `negociacion` and `volverllamar` are the `contacted`,
  `negotiated` and `callback` flags.
- **Activities.** A llamada whose respuesta is a visit outcome is a visit
  without a phone; any other is a call. The contact's name and email and the
  `comentario` are in the notes.
- **Skipped.** A cliente whose RUC is not 11 digits, a user without a username
  or with a repeated one, and every case, dato or llamada whose user, cliente or
  stage status did not map.

## Entel Empresas, from CRM Entel

| CRM Entel                          | work360                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| `zonal` of a user                  | A branch; a user without one joined "Sin zonal".          |
| `usuarios`                         | A user; a jefe's reports form a team in the jefe's zonal. |
| `clientes`, `telefonos`            | An organization per RUC, with its first phone.            |
| `bases`, `base_clientes`           | A campaign per base `tipo` and a segment per base name.   |
| `asignaciones_ejecutivo`           | An open hold: CRM Entel never released an assignment.     |
| `gestiones`                        | A call activity, with the contact and comment in notes.   |
| `ventas`, `venta_lineas`           | A mobile sale case.                                       |
| `ventas_fija`, `venta_fija_lineas` | A fixed sale case.                                        |

- **Roles.** EJECUTIVO is an executive, SUPERVISOR a supervisor, BACKOFFICE and
  ANALISTA back office, JEFE_COMERCIAL a sales manager, and ADMINISTRADOR and
  SUPERADMINISTRADOR an admin.
- **Emails.** CRM Entel kept no usable address, so every user has
  `<username>@crm-entel.invalid`.
- **Sales.** Every sale has a registro and a validacion stage; a sale still
  PENDIENTE was never validated. The back office owns validation. Activation
  follows validation and the commission follows activation. Entel pays the
  dealer twice, at the charge (cargo) and when the lines stay active (ganancia).
- **Left behind.** The buyer's DNI, parents, birth data, address and receiver: a
  sale case holds the deal, not the customer's papers. A company's address and
  owner names. A deleted base's rows. `actividad`, `notificaciones`,
  `intentos_login`, `venta_versiones` and `config`, which are session and audit
  data.

## Culqi, from the old culqi360 deploy

The culqi module kept the old deploy's schema, so most tables copied column for
column into the Culqi workspace, which already held its seeded reference rows
and installation admin.

- **Renamed.** `organization_people` is `contacts`, `back_office_assignments` is
  `back_office_teams`, `organization_owner_assignments` is
  `organization_ownerships` and `lead_policy_defaults` is
  `draw_policy_defaults`. A placement's `*_at` days are `*_on`.
- **Merged.** Currency, collection mode and account type kinds, settlement banks
  and audit action policies kept the seeded row where both had one. The source's
  branch "Infinity" took the seeded branch's id, so the installation admin and
  the sellers share one branch.
- **Users.** A user is an account, a membership and a member with the same role
  key. Their emails are their own.
- **Registry.** The deploy's company registry records are in the shared
  registry, and the Culqi workspace subscribes to each.
- **Left behind.** Pending notification intents and deliveries, and users'
  WhatsApp addresses, so work360 cannot message a real person from them.
  Uploaded files and their tokens: a fulfillment unit's payment proof is empty.
  Job queues, integration import rows, search usage counters and action
  observations.
