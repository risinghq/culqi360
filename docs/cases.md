# Cases

A case is one sale or request that moves through a workspace's process. Each
workspace defines its processes as case types, each with its own stages, roles
and fields. Entel's nota de cargo is a case type. Culqi's lead workflow predates
cases and stays its own model, behind the `culqi` workspace module described in
[database.md](database.md#modules). The code is in
[`apps/web/src/server/cases`](../apps/web/src/server/cases).

## Case types

A case type is a list of stages in process order, and the fields each stage
writes.

- **Stage.** A stage has one owner role from the fixed role list in
  [`rbac.ts`](../apps/web/src/domain/auth/access/rbac.ts), a list of statuses
  and the status it starts in.
- **Gate.** Every stage but the first names an earlier stage and the statuses
  that open it. Entel's back office stage opens only when validation holds
  `PROCEDE`. A stage also needs its gate stage to be open, so a gate that lists
  the gate stage's initial status still waits for the stages before it.
- **Field.** A field belongs to one stage and has a kind: `text`, `number`,
  `date` (`YYYY-MM-DD`), `choice` or `branch`. A choice field lists its choices.
  A branch field holds the id of one of the workspace's branches ("Sedes"), and
  the forms show the branch names. A required field must be filled before its
  stage leaves its initial status. A number field may set bounds: a minimum, a
  maximum, and whether it must be whole.
- **Conditional field.** A field that is not always required may be required
  when a condition holds: another field holds one of some values, its own stage
  holds one of some statuses, or a date field is at least some days old. The age
  counts calendar days in the app's time zone.
- **Correction.** A field may list later stages that also write it. Entel's
  validador corrects the line count and fixed charge the executive filed. A
  correcting stage must follow the field's stage on its gate chain, and it must
  keep a corrected required field filled before it leaves its initial status.
- **Amendable field.** A field may stay writable by its own stage after the
  stage locks, while a later stage on its gate chain holds one of some statuses.
  Entel's executive updates a quiebre's contacts while the validador holds it in
  `PROCESANDO`.
- **Branch-scoped stage.** A stage may name a branch field that an earlier stage
  writes. Only a user whose branch is the one the field holds writes the stage,
  and the stage's queue shows the case only to that branch. Entel's quiebre
  names its tienda, and only that tienda's supervisor validates it.

`checkCaseTypeDefinition` in
[`domain/definition.ts`](../apps/web/src/server/cases/domain/definition.ts)
checks a case type before it is stored: one opening stage, gates that point back
to earlier stages and known statuses, fields on known stages, corrections by
later stages, sound bounds, conditions on known fields, values and statuses, and
amendments on later stages and known statuses, and a branch scope on an earlier
branch field. The rules below trust a stored definition.

## Entel's processes

[`presets/entel.ts`](../apps/web/src/server/cases/presets/entel.ts) defines
Entel's three processes as safeapp runs them: the mobile and fixed notas de
cargo, and the quiebre. The functions take the catalogs (carteras and fixed
products) because they come from Entel's data at cutover. The development seed
fills them with invented values. Entel's tiendas, which safeapp calls zonales,
are the workspace's branches, so each process's zonal is a branch field.

The presets carry safeapp's conditional fields: the quiebre's equipment detail
when the problem is the equipment, its Entel ticket once the line is 90 days
old, and the fixed order's settlement date once the back office marks it
`COMPLETADO`. A mobile order needs at least one whole line, and a fixed charge
is never negative. While the validador holds a quiebre in `PENDIENTE` or
`PROCESANDO`, the executive may still amend its problem number, contacts and
comment, as safeapp allows. Before the validador acts, the executive may change
any registro field, which safeapp does not allow.

## Rules

The rules are in
[`domain/decide.ts`](../apps/web/src/server/cases/domain/decide.ts).

- Opening a case writes the first stage. Every stage starts in its initial
  status, and the first stage's required fields must be filled. They stay
  filled: every later write to the first stage checks them too.
- A required field, or a conditional field whose condition holds, must be filled
  when its stage leaves its initial status. The condition reads the values and
  statuses the write would leave. The forms apply the same rule and set the
  inputs' `required`, `min`, `max` and `step`, so the browser names an empty or
  out-of-range field before the save. The server's `case_fields_missing` and
  `case_fields_invalid` reach the user only as a generic message.
- A number outside its field's bounds fails with `case_fields_invalid`.
- Only the owner role writes a stage, and only while its gate is open. The
  opening stage belongs to the user who filed the case, not to every user with
  that role. A branch-scoped stage belongs to the owner role in the branch its
  field names; any other branch fails with `case_stage_not_owned`.
- A branch field accepts only a branch of the workspace.
- A stage locks once a stage gated on it leaves its initial status. A supervisor
  rules on values that cannot change after the ruling. A locked stage with
  amendable fields that hold their condition is amended instead: the write sets
  only those fields, keeps the stage's status, and keeps its required fields
  filled.
- A write sets only its own stage's fields and the fields it corrects. An empty
  string or `null` clears a field.
- Each write carries the case version the actor read. A write against an older
  version fails with `case_conflict`.

## Who sees a case

Two permissions in [`rbac.ts`](../apps/web/src/domain/auth/access/rbac.ts)
govern cases. `case:work` lets a role open the case pages at all.
`case:view:all` lets a role read every case in the workspace.

A user reads a case when one of these holds:

- the user filed it;
- the user's role has `case:view:all`;
- the user's role owns a stage after the opening one.

Reading is not writing. Each stage still follows the rules above, so a
supervisor with `case:view:all` reads an executive's case and writes only the
supervisor's stage.

## Screens

The pages are in [`features/cases`](../apps/web/src/features/cases).

- **`/cases`** lists one case type at a time. A role that owns a stage after the
  opening one sees a "Por atender" tab: the cases waiting at its stages, whose
  gate is open and whose stage still holds its initial status. "Todos" lists the
  user's own cases, or every case with `case:view:all`.
- **`/cases/:id`** shows each stage with its values. A stage the user can write
  shows a form; any other stage says why it is closed. An amended stage shows
  its other values, then a form for the amendable fields without the status.
- **`/cases/new`** opens a case for one company, named by its RUC. The case
  list's "Nuevo caso" button asks for the RUC. A campaign batch row links here
  with the RUC filled in, so the executive files the case from the record they
  are working.

## Tables

The tables are in
[`schema/modules/cases.ts`](../apps/web/src/server/platform/database/schema/modules/cases.ts).
All are workspace tables, so two workspaces can use the same case type key.

| Table               | Holds                                               |
| ------------------- | --------------------------------------------------- |
| `case_types`        | one row per process, unique by key in a workspace   |
| `case_stages`       | the stages, ordered by `position`                   |
| `case_fields`       | the fields, ordered by `position`                   |
| `cases`             | the field values as JSON, the owner and the version |
| `case_stage_states` | each stage's status and its last writer, for queues |

Opening a case looks up the RUC among the workspace's organizations and adds one
when none exists. The case never takes an organization id from the client,
because a foreign key check ignores row-level security. See
[Known limits](database.md#known-limits).
