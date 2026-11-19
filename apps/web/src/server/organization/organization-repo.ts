import { personDisplayName } from "~/domain/identity/display-name";
import { ContactId, OrganizationId, PersonId, newRowId } from "~/domain/ids";
import { insertBatches, listBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

export const LEGAL_REPRESENTATIVE_ROLE = "LEGAL_REPRESENTATIVE";

export type OrganizationProfile = {
  id: OrganizationId;
  ruc: string;
  legalName: string | null;
  lineOfBusiness: string | null;
  address: string | null;
  district: string | null;
  province: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
};

// Surnames are nullable: a prospected person may be known only by a single
// unstructured `names` string.
export type PersonIdentity = {
  dni: string;
  names: string;
  firstSurname: string | null;
  secondSurname: string | null;
  email: string | null;
};

export type PersonView = PersonIdentity & {
  id: PersonId;
  displayName: string;
};

// Membership stores the organization-specific contact channel.
export type Membership = {
  id: ContactId;
  organizationId: OrganizationId;
  person: PersonView;
  phone: string | null;
  email: string | null;
};

export type OrganizationRepository = {
  findOrganizationByRuc(ruc: string): Promise<OrganizationProfile | null>;
  findOrganizationById(id: OrganizationId): Promise<OrganizationProfile | null>;
  upsertOrganization(input: {
    ruc: string;
    legalName?: string | null;
    lineOfBusiness?: string | null;
    address?: string | null;
    district?: string | null;
    department?: string | null;
    /** Operation instant that stamps the row. */
    upsertedAt: Date;
  }): Promise<OrganizationProfile>;
  // Inserts the missing RUCs in one statement and leaves existing rows as
  // they are. Returns the id of every RUC given.
  ensureOrganizations(
    rows: readonly { ruc: string; legalName: string | null }[],
    at: Date,
  ): Promise<Map<string, OrganizationId>>;
  updateCommercialProfile(input: {
    organizationId: OrganizationId;
    lineOfBusiness: string | null;
  }): Promise<void>;
  applyEnrichment(input: {
    ruc: string;
    legalName?: string;
    address?: string;
    district?: string;
    department?: string;
  }): Promise<void>;
  upsertMembership(input: {
    organizationId: OrganizationId;
    person: PersonIdentity;
    phone: string | null;
    email: string | null;
    /** Operation instant that stamps the row. */
    upsertedAt: Date;
  }): Promise<Membership>;
  findMembership(input: {
    organizationId: OrganizationId;
    dni: string;
  }): Promise<Membership | null>;
  findMembershipById(id: ContactId): Promise<Membership | null>;
  setPrimaryRole(input: {
    organizationId: OrganizationId;
    contactId: ContactId;
    role: string;
    /** Instant the new primary interval opens and the old one closes. */
    effectiveAt: Date;
  }): Promise<void>;
  findPrimaryRepresentative(
    organizationId: OrganizationId,
  ): Promise<Membership | null>;
};

type OrganizationRow = {
  id: OrganizationId;
  ruc: string;
  legal_name: string | null;
  line_of_business: string | null;
  address: string | null;
  district: string | null;
  province: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
};

function toOrganizationProfile(row: OrganizationRow): OrganizationProfile {
  return {
    id: row.id,
    ruc: row.ruc,
    legalName: row.legal_name,
    lineOfBusiness: row.line_of_business,
    address: row.address,
    district: row.district,
    province: row.province,
    department: row.department,
    phone: row.phone,
    email: row.email,
  };
}

type MembershipRow = {
  id: ContactId;
  organization_id: OrganizationId;
  phone: string | null;
  email: string | null;
  person_id: PersonId;
  dni: string;
  names: string;
  first_surname: string | null;
  second_surname: string | null;
  person_email: string | null;
};

function toMembership(row: MembershipRow): Membership {
  const person: PersonView = {
    id: row.person_id,
    dni: row.dni,
    names: row.names,
    firstSurname: row.first_surname,
    secondSurname: row.second_surname,
    email: row.person_email,
    displayName: personDisplayName({
      names: row.names,
      first_surname: row.first_surname,
      second_surname: row.second_surname,
    }),
  };
  return {
    id: row.id,
    organizationId: row.organization_id,
    person,
    phone: row.phone,
    email: row.email,
  };
}

export function createOrganizationRepo(
  db: WorkspaceExecutor,
): OrganizationRepository {
  const membershipQuery = () =>
    db
      .selectFrom("contacts")
      .innerJoin("people", "people.id", "contacts.person_id")
      .select([
        "contacts.id as id",
        "contacts.organization_id as organization_id",
        "contacts.phone as phone",
        "contacts.email as email",
        "contacts.person_id as person_id",
        "people.dni as dni",
        "people.names as names",
        "people.first_surname as first_surname",
        "people.second_surname as second_surname",
        "people.email as person_email",
      ]);

  async function upsertPerson(
    person: PersonIdentity,
    upsertedAt: Date,
  ): Promise<PersonId> {
    await db
      .insertInto("people")
      .values({
        id: PersonId.mint(),
        dni: person.dni,
        names: person.names,
        first_surname: person.firstSurname,
        second_surname: person.secondSurname,
        email: person.email,
        created_at: upsertedAt,
        updated_at: upsertedAt,
      })
      // Preserve existing details when an incoming record only supplies a display name.
      .onConflict((oc) =>
        oc.columns(["dni"]).doUpdateSet((eb) => ({
          names: eb.ref("excluded.names"),
          first_surname: eb.fn.coalesce(
            eb.ref("excluded.first_surname"),
            eb.ref("people.first_surname"),
          ),
          second_surname: eb.fn.coalesce(
            eb.ref("excluded.second_surname"),
            eb.ref("people.second_surname"),
          ),
          email: eb.fn.coalesce(
            eb.ref("excluded.email"),
            eb.ref("people.email"),
          ),
          updated_at: upsertedAt,
        })),
      )
      .execute();

    const row = await db
      .selectFrom("people")
      .select("id")
      .where("dni", "=", person.dni)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  return {
    async findOrganizationByRuc(ruc) {
      const row = await db
        .selectFrom("organizations")
        .selectAll()
        .where("ruc", "=", ruc)
        .executeTakeFirst();
      return row ? toOrganizationProfile(row) : null;
    },

    async findOrganizationById(id) {
      const row = await db
        .selectFrom("organizations")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row ? toOrganizationProfile(row) : null;
    },

    async upsertOrganization(input) {
      await db
        .insertInto("organizations")
        .values({
          id: OrganizationId.mint(),
          ruc: input.ruc,
          legal_name: input.legalName ?? null,
          line_of_business: input.lineOfBusiness ?? null,
          address: input.address ?? null,
          district: input.district ?? null,
          department: input.department ?? null,
          created_at: input.upsertedAt,
        })
        .onConflict((oc) => oc.columns(["ruc"]).doNothing())
        .execute();

      const row = await db
        .selectFrom("organizations")
        .selectAll()
        .where("ruc", "=", input.ruc)
        .executeTakeFirstOrThrow();
      return toOrganizationProfile(row);
    },

    async ensureOrganizations(rows, at) {
      const ids = new Map<string, OrganizationId>();
      if (rows.length === 0) {
        return ids;
      }
      const organizations = rows.map((row) => ({
        id: OrganizationId.mint(),
        ruc: row.ruc,
        legal_name: row.legalName,
        created_at: at,
      }));
      for (const batch of insertBatches(organizations)) {
        // eslint-disable-next-line no-await-in-loop
        await db
          .insertInto("organizations")
          .values(batch)
          .onConflict((oc) => oc.columns(["ruc"]).doNothing())
          .execute();
      }
      for (const rucs of listBatches(rows.map((row) => row.ruc))) {
        // eslint-disable-next-line no-await-in-loop
        const found = await db
          .selectFrom("organizations")
          .select(["id", "ruc"])
          .where("ruc", "in", rucs)
          .execute();
        for (const row of found) {
          ids.set(row.ruc, row.id);
        }
      }
      return ids;
    },

    async updateCommercialProfile(input) {
      await db
        .updateTable("organizations")
        .set({ line_of_business: input.lineOfBusiness })
        .where("id", "=", input.organizationId)
        .execute();
    },

    async applyEnrichment(input) {
      const patch: {
        legal_name?: string;
        address?: string;
        district?: string;
        department?: string;
      } = {};
      if (input.legalName !== undefined) {
        patch.legal_name = input.legalName;
      }
      if (input.address !== undefined) {
        patch.address = input.address;
      }
      if (input.district !== undefined) {
        patch.district = input.district;
      }
      if (input.department !== undefined) {
        patch.department = input.department;
      }
      if (Object.keys(patch).length === 0) {
        return;
      }

      await db
        .updateTable("organizations")
        .set(patch)
        .where("ruc", "=", input.ruc)
        .execute();
    },

    async upsertMembership(input) {
      const personId = await upsertPerson(input.person, input.upsertedAt);

      await db
        .insertInto("contacts")
        .values({
          id: ContactId.mint(),
          person_id: personId,
          organization_id: input.organizationId,
          phone: input.phone,
          email: input.email,
          created_at: input.upsertedAt,
          updated_at: input.upsertedAt,
        })
        .onConflict((oc) =>
          oc.columns(["organization_id", "person_id"]).doUpdateSet((eb) => ({
            phone: eb.fn.coalesce(
              eb.ref("excluded.phone"),
              eb.ref("contacts.phone"),
            ),
            email: eb.fn.coalesce(
              eb.ref("excluded.email"),
              eb.ref("contacts.email"),
            ),
            updated_at: input.upsertedAt,
          })),
        )
        .execute();

      const row = await membershipQuery()
        .where("contacts.organization_id", "=", input.organizationId)
        .where("contacts.person_id", "=", personId)
        .executeTakeFirstOrThrow();
      return toMembership(row);
    },

    async findMembership(input) {
      const row = await membershipQuery()
        .where("contacts.organization_id", "=", input.organizationId)
        .where("people.dni", "=", input.dni)
        .executeTakeFirst();
      return row ? toMembership(row) : null;
    },

    async findMembershipById(id) {
      const row = await membershipQuery()
        .where("contacts.id", "=", id)
        .executeTakeFirst();
      return row ? toMembership(row) : null;
    },

    async setPrimaryRole(input) {
      const memberIds = (
        await db
          .selectFrom("contacts")
          .select("id")
          .where("organization_id", "=", input.organizationId)
          .execute()
      ).map((row) => row.id);

      // Close the current primary before opening the new interval: one primary
      // holder per (organization, role).
      if (memberIds.length > 0) {
        await db
          .updateTable("contact_roles")
          .set({ effective_to: input.effectiveAt, is_primary: false })
          .where("role", "=", input.role)
          .where("is_primary", "=", true)
          .where("contact_id", "in", memberIds)
          .execute();
      }

      await db
        .insertInto("contact_roles")
        .values({
          id: newRowId(),
          contact_id: input.contactId,
          role: input.role,
          is_primary: true,
          effective_from: input.effectiveAt,
        })
        .onConflict((oc) =>
          oc.columns(["contact_id", "role", "effective_to"]).doNothing(),
        )
        .execute();
    },

    async findPrimaryRepresentative(organizationId) {
      const row = await membershipQuery()
        .innerJoin("contact_roles as role", "role.contact_id", "contacts.id")
        .where("contacts.organization_id", "=", organizationId)
        .where("role.role", "=", LEGAL_REPRESENTATIVE_ROLE)
        .where("role.is_primary", "=", true)
        .where("role.effective_to", "is", null)
        .orderBy("role.effective_from", "desc")
        .executeTakeFirst();
      return row ? toMembership(row) : null;
    },
  };
}
