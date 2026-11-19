import type {
  BranchId,
  GpvSnapshotId,
  OrganizationId,
  UserId,
} from "~/domain/ids";
import { appInstantAt } from "~/domain/time/app-time";
import {
  addCalendarMonths,
  calendarMonthFromDate,
  calendarMonthStart,
  parseCalendarDate,
} from "~/domain/time/calendar-date";
import { insertBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

interface Ownership {
  executive_id: UserId;
  branch_id: BranchId;
  valid_from: Date;
  valid_until: Date | null;
}

// Credits each month the snapshot observed to the RUC's owner at that month's
// credit instant. A month credited before keeps its first credit.
export async function freezeUncreditedMerchantMonths(
  tx: WorkspaceExecutor,
  input: {
    snapshotId: GpvSnapshotId;
    cutAt: Date;
    creditedAt: Date;
  },
): Promise<void> {
  const observed = await tx
    .selectFrom("gpv_snapshot_placements as placement")
    .innerJoin("gpv_snapshot_observations as observation", (join) =>
      join
        .onRef("observation.snapshot_id", "=", "placement.snapshot_id")
        .onRef("observation.placement_id", "=", "placement.id"),
    )
    .innerJoin(
      "organizations as organization",
      "organization.ruc",
      "placement.ruc",
    )
    .select([
      "placement.ruc",
      "observation.realized_month as month",
      "organization.id as organization_id",
    ])
    .leftJoin("merchant_month_credits as credit", (join) =>
      join
        .onRef("credit.ruc", "=", "placement.ruc")
        .onRef("credit.month", "=", "observation.realized_month"),
    )
    .where("placement.snapshot_id", "=", input.snapshotId)
    .where("credit.ruc", "is", null)
    .distinct()
    .execute();
  if (observed.length === 0) {
    return;
  }

  const ownerships = await loadOwnerships(tx, input.snapshotId);

  const credits = observed.flatMap((row) => {
    const instant = creditInstant(row.month, input.cutAt);
    const owner = ownerAt(ownerships.get(row.organization_id) ?? [], instant);
    if (!owner) {
      return [];
    }
    return [
      {
        ruc: row.ruc,
        month: row.month,
        organization_id: row.organization_id,
        seller_user_id: owner.executive_id,
        branch_id: owner.branch_id,
        first_snapshot_id: input.snapshotId,
        credited_at: input.creditedAt,
      },
    ];
  });
  if (credits.length === 0) {
    return;
  }

  for (const batch of insertBatches(credits)) {
    // eslint-disable-next-line no-await-in-loop
    await tx
      .insertInto("merchant_month_credits")
      .values(batch)
      .onConflict((oc) => oc.columns(["ruc", "month"]).doNothing())
      .execute();
  }
}

// The last moment of the realized month in app time, or the cut when the
// month is still open.
function creditInstant(realizedMonth: string, cutAt: Date): Date {
  const start = parseCalendarDate(realizedMonth);
  if (!start) {
    throw new Error(`Invalid realized month: ${realizedMonth}`);
  }
  const next = calendarMonthStart(
    addCalendarMonths(calendarMonthFromDate(start), 1),
  );
  const monthEnd = appInstantAt(next).getTime() - 1;
  return new Date(Math.min(cutAt.getTime(), monthEnd));
}

function ownerAt(
  ownerships: readonly Ownership[],
  instant: Date,
): Ownership | undefined {
  let current: Ownership | undefined;
  for (const ownership of ownerships) {
    const started = ownership.valid_from.getTime() <= instant.getTime();
    const open =
      ownership.valid_until === null ||
      ownership.valid_until.getTime() > instant.getTime();
    if (
      started &&
      open &&
      (!current || ownership.valid_from > current.valid_from)
    ) {
      current = ownership;
    }
  }
  return current;
}

// Every ownership of an organization the snapshot placed, with the owner's
// branch, in one read.
async function loadOwnerships(
  tx: WorkspaceExecutor,
  snapshotId: GpvSnapshotId,
): Promise<Map<OrganizationId, Ownership[]>> {
  const rows = await tx
    .selectFrom("organization_ownerships as ownership")
    .innerJoin("members as member", "member.user_id", "ownership.executive_id")
    .select([
      "ownership.organization_id",
      "ownership.executive_id",
      "ownership.valid_from",
      "ownership.valid_until",
      "member.branch_id",
    ])
    .where("ownership.organization_id", "in", (eb) =>
      eb
        .selectFrom("gpv_snapshot_placements as placement")
        .innerJoin(
          "organizations as organization",
          "organization.ruc",
          "placement.ruc",
        )
        .select("organization.id")
        .where("placement.snapshot_id", "=", snapshotId),
    )
    .execute();
  const byOrganization = new Map<OrganizationId, Ownership[]>();
  for (const row of rows) {
    const list = byOrganization.get(row.organization_id) ?? [];
    list.push(row);
    byOrganization.set(row.organization_id, list);
  }
  return byOrganization;
}
