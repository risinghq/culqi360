import type { Insertable, Kysely } from "kysely";

import { personDisplayName } from "~/domain/identity/display-name";
import type { ContactHoldId, ContactId, UserId } from "~/domain/ids";
import type { ContactHoldDraft } from "~/server/contacts/domain/hold";
import type { Database } from "~/server/platform/database/types";

type NewContactHoldRow = Insertable<Database["contact_holds"]>;

export function createContactHoldsRepo(db: Kysely<Database>) {
  const create = (values: NewContactHoldRow) =>
    db.insertInto("contact_holds").values(values).executeTakeFirstOrThrow();

  const createMany = async (holds: ContactHoldDraft[]): Promise<void> => {
    if (holds.length === 0) {
      return;
    }
    await db.insertInto("contact_holds").values(holds).execute();
  };

  const findActiveByUser = (userId: UserId, activeAsOf: Date) =>
    db
      .selectFrom("contact_holds")
      .selectAll()
      .where("user_id", "=", userId)
      .where("status", "=", "active")
      .where("expires_at", ">", activeAsOf)
      .execute();

  const findActiveByUserWithContacts = async (
    userId: UserId,
    activeAsOf: Date,
  ) => {
    const rows = await db
      .selectFrom("contact_holds")
      .innerJoin("contacts", "contacts.id", "contact_holds.contact_id")
      .innerJoin("people", "people.id", "contacts.person_id")
      .select([
        "contact_holds.id as holdId",
        "contact_holds.held_at as heldAt",
        "contact_holds.expires_at as expiresAt",
        "contact_holds.status as status",
        "contacts.id as contactId",
        "people.names as names",
        "people.first_surname as firstSurname",
        "people.second_surname as secondSurname",
        "people.dni as dni",
        "contacts.phone as phonePrimary",
        "contacts.organization_id as organizationId",
      ])
      .where("contact_holds.user_id", "=", userId)
      .where("contact_holds.status", "=", "active")
      .where("contact_holds.expires_at", ">", activeAsOf)
      .orderBy("contact_holds.held_at", "desc")
      .execute();

    return rows.map((row) => ({
      holdId: row.holdId,
      heldAt: row.heldAt,
      expiresAt: row.expiresAt,
      status: row.status,
      contactId: row.contactId,
      name: personDisplayName({
        names: row.names,
        first_surname: row.firstSurname,
        second_surname: row.secondSurname,
      }),
      dni: row.dni,
      phonePrimary: row.phonePrimary,
      organizationId: row.organizationId,
    }));
  };

  const countActiveByUser = async (userId: UserId, activeAsOf: Date) => {
    const rows = await findActiveByUser(userId, activeAsOf);
    return rows.length;
  };

  const countActiveByUsers = async (userIds: UserId[], activeAsOf: Date) => {
    if (userIds.length === 0) {
      return [] as Array<{ userId: UserId; activeCount: number }>;
    }

    const rows = await db
      .selectFrom("contact_holds")
      .select((eb) => [
        "user_id as userId",
        eb.fn.count<number>("id").as("activeCount"),
      ])
      .where("user_id", "in", userIds)
      .where("status", "=", "active")
      .where("expires_at", ">", activeAsOf)
      .groupBy("user_id")
      .execute();

    return rows.map((row) => ({
      userId: row.userId,
      activeCount: row.activeCount,
    }));
  };

  const findActiveForContact = (
    userId: UserId,
    contactId: ContactId,
    activeAsOf: Date,
  ) =>
    db
      .selectFrom("contact_holds")
      .selectAll()
      .where("user_id", "=", userId)
      .where("contact_id", "=", contactId)
      .where("status", "=", "active")
      .where("expires_at", ">", activeAsOf)
      .executeTakeFirst();

  const hasActiveForContact = async (
    userId: UserId,
    contactId: ContactId,
    activeAsOf: Date,
  ) => {
    const row = await findActiveForContact(userId, contactId, activeAsOf);
    return !!row;
  };

  const findActiveByIdForUser = (
    id: ContactHoldId,
    userId: UserId,
    activeAsOf: Date,
  ) =>
    db
      .selectFrom("contact_holds")
      .selectAll()
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .where("status", "=", "active")
      .where("expires_at", ">", activeAsOf)
      .executeTakeFirst();

  const markCompleted = (id: ContactHoldId, userId: UserId) =>
    db
      .updateTable("contact_holds")
      .set({ status: "completed" })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .execute();

  return {
    create,
    createMany,
    findActiveByUser,
    findActiveByUserWithContacts,
    countActiveByUser,
    countActiveByUsers,
    findActiveForContact,
    hasActiveForContact,
    findActiveByIdForUser,
    markCompleted,
  };
}

export type ContactHoldsRepo = ReturnType<typeof createContactHoldsRepo>;
