import type { Insertable } from "kysely";

import { fail, type DomainError } from "~/domain/errors";
import {
  type GpvSnapshotId,
  GpvSnapshotIssueId,
  GpvSnapshotPlacementId,
} from "~/domain/ids";
import {
  calendarDateFromParts,
  calendarMonthFromDate,
} from "~/domain/time/calendar-date";
import { insertBatches, listBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { Err, Ok, type Result } from "~/shared/result";
import type { TableBody } from "~/shared/table";

import { decodeLines } from "../intake/decode-row";
import { saleIdentityKey } from "../intake/sale-identity";
import type { DecodedLines, Rejection, SourceRow } from "../intake/types";

type PlacementInsert = Insertable<WorkspaceDatabase["gpv_snapshot_placements"]>;
type IssueInsert = Insertable<WorkspaceDatabase["gpv_snapshot_issues"]>;

export interface StagedGpvLines {
  staged: number;
  rejected: number;
}

/** Decodes one batch of report lines and stages it into a snapshot that is
 * still staging. */
export async function stageGpvLines(
  db: WorkspaceExecutor,
  input: { snapshotId: GpvSnapshotId; table: TableBody; stagedAt: Date },
): Promise<Result<StagedGpvLines, DomainError>> {
  return db.transaction().execute(async (tx) => {
    const snapshot = await tx
      .selectFrom("gpv_snapshots")
      .select(["state", "cut_at"])
      .where("id", "=", input.snapshotId)
      .executeTakeFirst();
    if (!snapshot) {
      return Err(fail("gpv_snapshot_not_found"));
    }
    if (snapshot.state !== "staging") {
      return Err(fail("gpv_snapshot_not_staging"));
    }

    const cutMonth = calendarMonthFromDate(
      calendarDateFromParts({
        year: snapshot.cut_at.getUTCFullYear(),
        month: snapshot.cut_at.getUTCMonth() + 1,
        day: snapshot.cut_at.getUTCDate(),
      }),
    );
    const decoded = decodeLines(input.table, cutMonth);
    return Ok(
      await stageGpvRows(tx, input.snapshotId, decoded, input.stagedAt),
    );
  });
}

/** Writes decoded rows into a staging snapshot. A row repeating a placement
 * already staged becomes a rejection, and a row whose RUC or sale month
 * differs from the active snapshot's placement becomes a blocking issue. */
export async function stageGpvRows(
  db: WorkspaceExecutor,
  snapshotId: GpvSnapshotId,
  decoded: DecodedLines,
  stagedAt: Date,
): Promise<StagedGpvLines> {
  const rejections = [...decoded.rejections];
  const unique = new Map<string, SourceRow>();
  for (const row of decoded.rows) {
    const key = placementKey(row);
    if (unique.has(key)) {
      rejections.push(repeated(row));
    } else {
      unique.set(key, row);
    }
  }

  const staged = await insertPlacements(db, snapshotId, unique);
  for (const [key, row] of unique) {
    if (!staged.has(key)) {
      rejections.push(repeated(row));
    }
  }
  await insertObservations(db, snapshotId, unique, staged);

  const issues = [
    ...rejections.map((rejection) =>
      rejectionIssue(snapshotId, rejection, stagedAt),
    ),
    ...(await changedPlacementIssues(db, snapshotId, unique, staged, stagedAt)),
  ];
  for (const chunk of insertBatches(issues)) {
    // eslint-disable-next-line no-await-in-loop
    await db.insertInto("gpv_snapshot_issues").values(chunk).execute();
  }

  return { staged: staged.size, rejected: rejections.length };
}

function placementKey(row: SourceRow): string {
  return saleIdentityKey(row.merchantId, row.product, row.serialNumber);
}

function repeated(row: SourceRow): Rejection {
  return {
    rowNumber: row.rowNumber,
    ruc: row.ruc,
    merchantId: row.merchantId,
    serialNumber: row.serialNumber,
    reason: "Colocación repetida en el archivo",
    raw: row.raw,
  };
}

// A conflicting key was staged by an earlier batch, so it is left out of the
// returned ids.
async function insertPlacements(
  db: WorkspaceExecutor,
  snapshotId: GpvSnapshotId,
  rows: ReadonlyMap<string, SourceRow>,
): Promise<Map<string, GpvSnapshotPlacementId>> {
  const idByKey = new Map<string, GpvSnapshotPlacementId>();
  const placements = [...rows].map(([key, row]) =>
    toPlacement(snapshotId, key, row),
  );
  for (const chunk of insertBatches(placements)) {
    // eslint-disable-next-line no-await-in-loop
    const inserted = await db
      .insertInto("gpv_snapshot_placements")
      .values(chunk)
      .onConflict((oc) =>
        oc.columns(["snapshot_id", "placement_key"]).doNothing(),
      )
      .returning(["id", "placement_key"])
      .execute();
    for (const placement of inserted) {
      idByKey.set(placement.placement_key, placement.id);
    }
  }
  return idByKey;
}

function toPlacement(
  snapshotId: GpvSnapshotId,
  key: string,
  row: SourceRow,
): PlacementInsert {
  return {
    id: GpvSnapshotPlacementId.mint(),
    snapshot_id: snapshotId,
    row_number: row.rowNumber,
    placement_key: key,
    merchant_id: row.merchantId,
    product: row.product,
    serial_number: row.serialNumber,
    ruc: row.ruc,
    sold_on: row.soldAt,
    sale_month: `${row.saleMonth}-01`,
    trade_name: row.tradeName,
    legal_name: row.legalName,
    culqi_user_code: row.culqiUserCode,
    culqi_user_name: row.culqiUserName,
    mesa: row.mesa,
    channel: row.channel,
    subchannel: row.subchannel,
    offer_amount: row.offerAmount,
    promotion: row.promotion,
    client_type: row.clientType,
    stock_type: row.stockType,
    trial_on: row.trialAt,
    activated_on: row.activatedAt,
    last_transaction_on: row.lastTransactionAt,
    m0_plus_15d_gpv: row.m0Plus15dGpv,
    m0_plus_15d_trx: row.m0Plus15dTrx,
    raw: JSON.stringify(row.raw),
  };
}

async function insertObservations(
  db: WorkspaceExecutor,
  snapshotId: GpvSnapshotId,
  rows: ReadonlyMap<string, SourceRow>,
  staged: ReadonlyMap<string, GpvSnapshotPlacementId>,
): Promise<void> {
  const values = [...rows].flatMap(([key, row]) => {
    const placementId = staged.get(key);
    if (placementId === undefined) {
      return [];
    }
    return row.gpv.map((observation) => ({
      snapshot_id: snapshotId,
      placement_id: placementId,
      month_offset: observation.offset,
      sale_month: `${row.saleMonth}-01`,
      gpv: observation.gpv,
      trx: observation.trx,
    }));
  });
  for (const chunk of insertBatches(values)) {
    // eslint-disable-next-line no-await-in-loop
    await db.insertInto("gpv_snapshot_observations").values(chunk).execute();
  }
}

function rejectionIssue(
  snapshotId: GpvSnapshotId,
  rejection: Rejection,
  createdAt: Date,
): IssueInsert {
  return {
    id: GpvSnapshotIssueId.mint(),
    snapshot_id: snapshotId,
    issue_key: `parse:${rejection.rowNumber}`,
    issue_type: "row_rejected",
    entity_key: null,
    severity: "blocking",
    detail: rejection.reason,
    previous_value: null,
    candidate_value: JSON.stringify(rejection.raw),
    created_at: createdAt,
  };
}

// Compares the batch against the active snapshot by key, so each batch reads
// only the placements it staged.
async function changedPlacementIssues(
  db: WorkspaceExecutor,
  snapshotId: GpvSnapshotId,
  rows: ReadonlyMap<string, SourceRow>,
  staged: ReadonlyMap<string, GpvSnapshotPlacementId>,
  createdAt: Date,
): Promise<IssueInsert[]> {
  if (staged.size === 0) {
    return [];
  }
  const active = await db
    .selectFrom("gpv_snapshots")
    .select("id")
    .where("state", "=", "active")
    .executeTakeFirst();
  if (!active) {
    return [];
  }
  const previous = [];
  for (const keys of listBatches([...staged.keys()], 1)) {
    // eslint-disable-next-line no-await-in-loop
    const found = await db
      .selectFrom("gpv_snapshot_placements")
      .select(["placement_key", "ruc", "sale_month"])
      .where("snapshot_id", "=", active.id)
      .where("placement_key", "in", keys)
      .execute();
    previous.push(...found);
  }

  const issues: IssueInsert[] = [];
  for (const old of previous) {
    const row = rows.get(old.placement_key);
    if (!row) {
      continue;
    }
    const key = old.placement_key;
    if (old.ruc !== row.ruc) {
      issues.push({
        id: GpvSnapshotIssueId.mint(),
        snapshot_id: snapshotId,
        issue_key: `ruc:${key}`,
        issue_type: "placement_ruc_changed",
        entity_key: key,
        severity: "blocking",
        detail: "La colocación cambió de RUC entre cortes.",
        previous_value: JSON.stringify({ ruc: old.ruc }),
        candidate_value: JSON.stringify({ ruc: row.ruc }),
        created_at: createdAt,
      });
    }
    const saleMonth = `${row.saleMonth}-01`;
    if (old.sale_month !== saleMonth) {
      issues.push({
        id: GpvSnapshotIssueId.mint(),
        snapshot_id: snapshotId,
        issue_key: `sale-month:${key}`,
        issue_type: "sale_month_changed",
        entity_key: key,
        severity: "blocking",
        detail: "La colocación cambió de mes de venta entre cortes.",
        previous_value: JSON.stringify({ saleMonth: old.sale_month }),
        candidate_value: JSON.stringify({ saleMonth }),
        created_at: createdAt,
      });
    }
  }
  return issues;
}
