import type { TestDbContext } from "@tests/support/runtime/db";

import { ContactHoldId, type ContactId, type UserId } from "~/domain/ids";

export type ContactHoldSeedRow = {
  userId: UserId;
  contactId: ContactId;
  heldAt: Date;
  expiresAt: Date;
  status: "active" | "completed";
};

export function createContactHoldsTestKit(ctx: TestDbContext) {
  return {
    async seedHolds(rows: ContactHoldSeedRow[]): Promise<void> {
      if (rows.length === 0) {
        return;
      }
      await ctx.db
        .insertInto("contact_holds")
        .values(
          rows.map((row) => ({
            id: ContactHoldId.mint(),
            user_id: row.userId,
            contact_id: row.contactId,
            held_at: row.heldAt,
            expires_at: row.expiresAt,
            status: row.status,
          })),
        )
        .execute();
    },

    async activeContactIdsForUser(
      userId: UserId,
      asOf: Date = new Date(),
    ): Promise<ContactId[]> {
      const rows = await ctx.repos.contactHolds.findActiveByUser(userId, asOf);
      return rows.map((row) => row.contact_id);
    },

    async hasActiveHold(
      userId: UserId,
      contactId: ContactId,
      asOf: Date = new Date(),
    ): Promise<boolean> {
      return ctx.repos.contactHolds.hasActiveForContact(
        userId,
        contactId,
        asOf,
      );
    },
  };
}
