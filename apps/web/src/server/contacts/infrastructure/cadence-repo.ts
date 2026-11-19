import type { Kysely } from "kysely";

import type { ContactId, UserId } from "~/domain/ids";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

type CadenceSnapshot = {
  contactId: ContactId;
  lastContactedAt: Date | null;
  cooldownUntil: Date | null;
};

export function createContactCadenceRepo(db: Kysely<WorkspaceDatabase>) {
  async function findMany(
    contactIds: ContactId[],
  ): Promise<Map<ContactId, CadenceSnapshot>> {
    if (contactIds.length === 0) {
      return new Map();
    }

    const rows = await db
      .selectFrom("contact_cadence")
      .selectAll()
      .where("contact_id", "in", contactIds)
      .execute();

    return new Map(
      rows.map((row) => [
        row.contact_id,
        {
          contactId: row.contact_id,
          lastContactedAt: row.last_contacted_at,
          cooldownUntil: row.cooldown_until,
        },
      ]),
    );
  }

  function touch(input: {
    contactId: ContactId;
    userId: UserId;
    contactedAt: Date;
    cooldownUntil: Date | null;
  }) {
    return db
      .insertInto("contact_cadence")
      .values({
        contact_id: input.contactId,
        last_contacted_at: input.contactedAt,
        last_contacted_by_user_id: input.userId,
        cooldown_until: input.cooldownUntil,
      })
      .onConflict((oc) =>
        oc.column("contact_id").doUpdateSet({
          last_contacted_at: input.contactedAt,
          last_contacted_by_user_id: input.userId,
          cooldown_until: input.cooldownUntil,
        }),
      )
      .execute();
  }

  return {
    findMany,
    touch,
  };
}

export type ContactCadenceRepo = ReturnType<typeof createContactCadenceRepo>;
