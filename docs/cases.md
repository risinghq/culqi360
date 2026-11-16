# Cases

A case is one sale or request that moves through a workspace's process. Each
workspace defines its processes as case types. Culqi's lead and Entel's nota de
cargo are both case types, with different stages, roles and fields. The code is
in [`apps/web/src/server/cases`](../apps/web/src/server/cases).

## Case types

A case type is a list of stages in process order, and the fields each stage
writes.

- **Stage.** A stage has one owner role from the fixed role list in
  [`rbac.ts`](../apps/web/src/domain/auth/access/rbac.ts), a list of statuses
  and the status it starts in.
- **Gate.** Every stage but the first names an earlier stage and the statuses
  that open it. Entel's back office stage opens only when validation holds
  `PROCEDE`.
- **Field.** A field belongs to one stage and has a kind: `text`, `number`,
  `date` (`YYYY-MM-DD`) or `choice`. A choice field lists its choices. A
  required field must be filled before its stage leaves its initial status.

`checkCaseTypeDefinition` in
[`domain/definition.ts`](../apps/web/src/server/cases/domain/definition.ts)
checks a case type before it is stored: one opening stage, gates that point back
to earlier stages and known statuses, and fields on known stages. The rules
below trust a stored definition.

## Rules

The rules are in
[`domain/decide.ts`](../apps/web/src/server/cases/domain/decide.ts).

- Opening a case writes the first stage. Every stage starts in its initial
  status, and the first stage's required fields must be filled.
- Only the owner role writes a stage, and only while its gate is open.
- A stage locks once a stage gated on it leaves its initial status. A supervisor
  rules on values that cannot change after the ruling.
- A write sets only its own stage's fields. An empty string or `null` clears a
  field.
- Each write carries the case version the actor read. A write against an older
  version fails with `case_conflict`.

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
