import type { Kysely } from "kysely";

import { ActivityOutcomeId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type {
  ActivityChannel,
  WorkspaceDatabase,
} from "~/server/platform/database/types";

import type { CatalogOutcome, OutcomeSeed } from "../domain/outcome-seed";

const OUTCOME_COLUMNS = [
  "id",
  "label",
  "channel",
  "contacted",
  "negotiated",
  "callback",
  "position",
] as const;

export function createOutcomesRepo(db: Kysely<WorkspaceDatabase>) {
  return {
    listLive() {
      return db
        .selectFrom("activity_outcomes")
        .select(OUTCOME_COLUMNS)
        .where("archived_at", "is", null)
        .orderBy("channel", "asc")
        .orderBy("position", "asc")
        .orderBy("label", "asc")
        .execute();
    },

    findLive(id: ActivityOutcomeId) {
      return db
        .selectFrom("activity_outcomes")
        .select(OUTCOME_COLUMNS)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
    },

    findLiveByLabel(channel: ActivityChannel, label: string) {
      return db
        .selectFrom("activity_outcomes")
        .select("id")
        .where("channel", "=", channel)
        .where("label", "=", label)
        .where("archived_at", "is", null)
        .executeTakeFirst();
    },

    // The seeds keep their order; an empty list inserts nothing.
    async insertMany(seeds: readonly CatalogOutcome[], createdAt: Date) {
      if (seeds.length === 0) {
        return [];
      }
      const rows = seeds.map((seed, position) => ({
        id: seed.id ?? ActivityOutcomeId.mint(),
        label: seed.label,
        channel: seed.channel,
        contacted: seed.contacted,
        negotiated: seed.negotiated,
        callback: seed.callback,
        position,
        created_at: createdAt,
      }));
      const inserted = [];
      for (const batch of insertBatches(rows)) {
        // eslint-disable-next-line no-await-in-loop
        const written = await db
          .insertInto("activity_outcomes")
          .values(batch)
          .returning(["id", "label", "channel"])
          .execute();
        inserted.push(...written);
      }
      return inserted;
    },

    async nextPosition(channel: ActivityChannel): Promise<number> {
      const row = await db
        .selectFrom("activity_outcomes")
        .select((eb) => eb.fn.max("position").as("position"))
        .where("channel", "=", channel)
        .executeTakeFirst();
      return row?.position === null || row?.position === undefined
        ? 0
        : row.position + 1;
    },

    async create(seed: OutcomeSeed & { position: number; createdAt: Date }) {
      const row = await db
        .insertInto("activity_outcomes")
        .values({
          id: ActivityOutcomeId.mint(),
          label: seed.label,
          channel: seed.channel,
          contacted: seed.contacted,
          negotiated: seed.negotiated,
          callback: seed.callback,
          position: seed.position,
          created_at: seed.createdAt,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    },

    // The channel stays: activities already recorded hold it in their key.
    async update(
      id: ActivityOutcomeId,
      changes: Omit<OutcomeSeed, "channel">,
    ): Promise<boolean> {
      const result = await db
        .updateTable("activity_outcomes")
        .set({
          label: changes.label,
          contacted: changes.contacted,
          negotiated: changes.negotiated,
          callback: changes.callback,
        })
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async archive(id: ActivityOutcomeId, at: Date): Promise<boolean> {
      const result = await db
        .updateTable("activity_outcomes")
        .set({ archived_at: at })
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },
  };
}

export type OutcomesRepo = ReturnType<typeof createOutcomesRepo>;
