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
  `date` (`YYYY-MM-DD`) or `choice`. A choice field lists its choices. A
  required field must be filled before its stage leaves its initial status.
- **Correction.** A field may list later stages that also write it. Entel's
  validador corrects the line count and fixed charge the executive filed. A
  correcting stage must follow the field's stage on its gate chain, and it must
  keep a corrected required field filled before it leaves its initial status.

`checkCaseTypeDefinition` in
[`domain/definition.ts`](../apps/web/src/server/cases/domain/definition.ts)
checks a case type before it is stored: one opening stage, gates that point back
to earlier stages and known statuses, fields on known stages, and corrections by
later stages. The rules below trust a stored definition.

## Rules

The rules are in
[`domain/decide.ts`](../apps/web/src/server/cases/domain/decide.ts).

- Opening a case writes the first stage. Every stage starts in its initial
  status, and the first stage's required fields must be filled.
- Only the owner role writes a stage, and only while its gate is open. The
  opening stage belongs to the user who filed the case, not to every user with
  that role.
- A stage locks once a stage gated on it leaves its initial status. A supervisor
  rules on values that cannot change after the ruling.
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
  shows a form; any other stage says why it is closed.
- **`/cases/new`** opens a case for one company. A campaign batch row links here
  with the company's organization and RUC, so the executive files the case from
  the record they are working.

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

A foreign key check ignores row-level security, so opening a case first reads
the organization in the workspace. See [Known limits](database.md#known-limits).
