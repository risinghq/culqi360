import type {
  ContactHoldId,
  ContactId,
  IdColumn,
  NullableIdColumn,
  UserId,
} from "~/domain/ids";

export interface ContactHoldsTable {
  id: IdColumn<ContactHoldId>;
  user_id: IdColumn<UserId>;
  contact_id: IdColumn<ContactId>;
  held_at: Date;
  expires_at: Date;
  status: "active" | "completed" | "expired";
}

export interface ContactCadenceTable {
  contact_id: IdColumn<ContactId>;
  last_contacted_at: Date | null;
  last_contacted_by_user_id: NullableIdColumn<UserId>;
  cooldown_until: Date | null;
}
