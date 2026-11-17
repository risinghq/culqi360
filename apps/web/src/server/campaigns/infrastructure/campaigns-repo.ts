import { sql, type Kysely } from "kysely";

import type {
  CampaignId,
  CampaignRecordId,
  OrganizationId,
  UserId,
} from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";

export type NewCampaignRecord = {
  organizationId: OrganizationId;
  segment: string;
  facts: Record<string, string>;
};

export type HeldRecord = {
  id: CampaignRecordId;
  organizationId: OrganizationId;
  ruc: string;
  legalName: string | null;
  segment: string;
  facts: Record<string, string>;
};

export type CampaignSummary = {
  id: CampaignId;
  name: string;
  createdAt: Date;
};

export function createCampaignsRepo(db: Kysely<Database>) {
  const heldQuery = (campaignId: CampaignId, userId: UserId) =>
    db
      .selectFrom("campaign_records as record")
      .innerJoin("campaign_holds as holder", "holder.record_id", "record.id")
      .innerJoin("organizations as org", "org.id", "record.organization_id")
      .select([
        "record.id as id",
        "record.organization_id as organizationId",
        "org.ruc as ruc",
        "org.legal_name as legalName",
        "record.segment as segment",
        "record.facts as facts",
      ])
      .where("record.campaign_id", "=", campaignId)
      .where("record.worked_at", "is", null)
      .where("holder.user_id", "=", userId)
      .where("holder.released_at", "is", null);

  // Records nobody has worked and nobody holds.
  const poolQuery = (campaignId: CampaignId) =>
    db
      .selectFrom("campaign_records as record")
      .where("record.campaign_id", "=", campaignId)
      .where("record.worked_at", "is", null)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("campaign_holds as holder")
              .select(sql.lit(1).as("held"))
              .whereRef("holder.record_id", "=", "record.id")
              .where("holder.released_at", "is", null),
          ),
        ),
      );

  return {
    async ensureCampaign(name: string, at: Date): Promise<CampaignId> {
      await db
        .insertInto("campaigns")
        .values({ name, created_at: at })
        .onConflict((oc) => oc.columns(["workspace_id", "name"]).doNothing())
        .execute();
      const row = await db
        .selectFrom("campaigns")
        .select("id")
        .where("name", "=", name)
        .executeTakeFirstOrThrow();
      return row.id;
    },

    listCampaigns(): Promise<CampaignSummary[]> {
      return db
        .selectFrom("campaigns")
        .select(["id", "name", "created_at as createdAt"])
        .orderBy("created_at", "desc")
        .execute();
    },

    async campaignExists(id: CampaignId): Promise<boolean> {
      const row = await db
        .selectFrom("campaigns")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      return row !== undefined;
    },

    // A reload rewrites what the file says and keeps the record's id, its
    // holders and whether it was worked.
    async upsertRecords(
      campaignId: CampaignId,
      records: readonly NewCampaignRecord[],
      at: Date,
    ): Promise<void> {
      if (records.length === 0) {
        return;
      }
      await db
        .insertInto("campaign_records")
        .values(
          records.map((record) => ({
            campaign_id: campaignId,
            organization_id: record.organizationId,
            segment: record.segment,
            facts: record.facts,
            imported_at: at,
          })),
        )
        .onConflict((oc) =>
          oc.constraint("campaign_records_natural_key").doUpdateSet((eb) => ({
            facts: eb.ref("excluded.facts"),
            imported_at: eb.ref("excluded.imported_at"),
          })),
        )
        .execute();
    },

    findHeld(campaignId: CampaignId, userId: UserId): Promise<HeldRecord[]> {
      return heldQuery(campaignId, userId).orderBy("record.id").execute();
    },

    // The record's company when the user holds it, whether or not it is
    // worked: an agent may call back a record it just marked.
    async findHeldRecord(
      recordId: CampaignRecordId,
      userId: UserId,
    ): Promise<{ organizationId: OrganizationId } | null> {
      const row = await db
        .selectFrom("campaign_records as record")
        .innerJoin("campaign_holds as holder", "holder.record_id", "record.id")
        .select("record.organization_id as organizationId")
        .where("record.id", "=", recordId)
        .where("holder.user_id", "=", userId)
        .where("holder.released_at", "is", null)
        .executeTakeFirst();
      return row ?? null;
    },

    // SKIP LOCKED lets parallel draws take disjoint rows. A row a concurrent
    // draw committed after this statement's snapshot can still be picked;
    // the one-holder index refuses it and the insert skips it.
    async draw(input: {
      campaignId: CampaignId;
      segment: string | null;
      userId: UserId;
      limit: number;
      at: Date;
    }): Promise<CampaignRecordId[]> {
      let pool = poolQuery(input.campaignId).select("record.id");
      if (input.segment !== null) {
        pool = pool.where("record.segment", "=", input.segment);
      }
      const picked = await pool
        .orderBy("record.id")
        .limit(input.limit)
        .forUpdate()
        .skipLocked()
        .execute();
      if (picked.length === 0) {
        return [];
      }
      const assigned = await db
        .insertInto("campaign_holds")
        .values(
          picked.map((row) => ({
            record_id: row.id,
            user_id: input.userId,
            held_at: input.at,
          })),
        )
        .onConflict((oc) =>
          oc
            .column("record_id")
            .where(sql.ref("released_at"), "is", null)
            .doNothing(),
        )
        .returning("record_id")
        .execute();
      return assigned.map((row) => row.record_id);
    },

    async releaseUnworked(input: {
      campaignId: CampaignId;
      userId: UserId;
      at: Date;
    }): Promise<number> {
      const result = await db
        .updateTable("campaign_holds as holder")
        .set({ released_at: input.at })
        .where("holder.user_id", "=", input.userId)
        .where("holder.released_at", "is", null)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("campaign_records as record")
              .select(sql.lit(1).as("open"))
              .whereRef("record.id", "=", "holder.record_id")
              .where("record.campaign_id", "=", input.campaignId)
              .where("record.worked_at", "is", null),
          ),
        )
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },

    // The open record the user holds, locked until the transaction ends.
    findHeldOpenRecord(input: { recordId: CampaignRecordId; userId: UserId }) {
      return db
        .selectFrom("campaign_records as record")
        .innerJoin("campaign_holds as holder", "holder.record_id", "record.id")
        .select(["record.organization_id", "holder.held_at"])
        .where("record.id", "=", input.recordId)
        .where("record.worked_at", "is", null)
        .where("holder.user_id", "=", input.userId)
        .where("holder.released_at", "is", null)
        .forUpdate("record")
        .executeTakeFirst();
    },

    // Only the current holder may close a record.
    async markWorked(input: {
      recordId: CampaignRecordId;
      userId: UserId;
      at: Date;
    }): Promise<boolean> {
      const result = await db
        .updateTable("campaign_records as record")
        .set({ worked_at: input.at })
        .where("record.id", "=", input.recordId)
        .where("record.worked_at", "is", null)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("campaign_holds as holder")
              .select(sql.lit(1).as("held"))
              .whereRef("holder.record_id", "=", "record.id")
              .where("holder.user_id", "=", input.userId)
              .where("holder.released_at", "is", null),
          ),
        )
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    async availableBySegment(
      campaignId: CampaignId,
    ): Promise<{ segment: string; available: number }[]> {
      const rows = await poolQuery(campaignId)
        .select((eb) => [
          "record.segment as segment",
          eb.fn.countAll<string>().as("available"),
        ])
        .groupBy("record.segment")
        .orderBy("record.segment")
        .execute();
      return rows.map((row) => ({
        segment: row.segment,
        available: Number(row.available),
      }));
    },
  };
}

export type CampaignsRepo = ReturnType<typeof createCampaignsRepo>;
