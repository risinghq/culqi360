# Campaigns

A campaign is a list of companies a workspace loads from a file and hands out to
executives in batches. Entel's monthly base is a campaign. Culqi's engine draw
is a separate source and does not use campaigns. The code is in
[`apps/web/src/server/campaigns`](../apps/web/src/server/campaigns).

## Import

An import names the campaign and gives one row per company: RUC, legal name,
segment and the file's other columns as facts.

- A row with a bad RUC or no segment is rejected and reported by line. The rest
  of the file loads.
- A company that appears twice in one segment keeps the later line.
- The company is stored in `organizations`. A RUC the workspace already has
  keeps its row and its name.
- A record is keyed by campaign, company and segment. Loading the file again
  rewrites the facts and keeps the record's id, its holders and whether it was
  worked.

## Batches

The rules are in
[`infrastructure/campaigns-repo.ts`](../apps/web/src/server/campaigns/infrastructure/campaigns-repo.ts)
and [`application/`](../apps/web/src/server/campaigns/application).

- A draw hands the executive up to 30 records nobody holds and nobody has
  worked, optionally from one segment.
- An executive holds one batch at a time. While any record in it is unworked, a
  draw returns that batch and takes nothing new.
- Two executives drawing at once get disjoint records.
- Only the holder can mark a record worked.
- A release returns the executive's unworked records to the pool. Worked records
  keep their holder.

## Tables

The tables are in
[`schema/modules/campaigns.ts`](../apps/web/src/server/platform/database/schema/modules/campaigns.ts).
All are workspace tables.

| Table                  | Holds                                                    |
| ---------------------- | -------------------------------------------------------- |
| `campaigns`            | one row per campaign, unique by name in a workspace      |
| `campaign_records`     | one company in one segment, the facts and when worked    |
| `campaign_assignments` | every hand-out, open until released, so history survives |

A unique index allows one open assignment per record, so a draw that races
another cannot give a record to two executives.
