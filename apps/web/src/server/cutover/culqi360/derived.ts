import { UNUSABLE_PASSWORD_HASH } from "~/server/auth/password/password";

import type { SourceRow } from "../shared/postgres";

// Usernames are unique across workspaces, and some Culqi sellers share their
// handle with an Entel account.
const USERNAME_PREFIX = "culqi.";

// A column the source no longer has fails the run instead of copying a null.
function field(row: SourceRow, name: string): string | null {
  const value = row[name];
  if (value === undefined) {
    throw new Error(`cutover_source_column_missing:${name}`);
  }
  return value;
}

function pick(row: SourceRow, names: readonly string[]): SourceRow {
  return Object.fromEntries(names.map((name) => [name, field(row, name)]));
}

const username = (user: SourceRow) =>
  `${USERNAME_PREFIX}${(field(user, "username") ?? "").toLowerCase()}`;

const PERSON = ["email", "names", "first_surname", "second_surname"];

// A culqi360 user held one workspace's role by key; a member points at the
// role row too.
export function memberRows(
  users: readonly SourceRow[],
  roleIds: ReadonlyMap<string, string>,
): SourceRow[] {
  return users.map((user) => {
    const roleId = roleIds.get(field(user, "role") ?? "");
    if (!roleId) {
      throw new Error("cutover_role_missing");
    }
    return {
      ...pick(user, [
        "branch_id",
        "team_id",
        "role",
        "executive_category",
        "is_active",
        "expires_at",
        "expiry_notified_at",
        "onboarding_completed_at",
        ...PERSON,
        "created_at",
      ]),
      user_id: field(user, "id"),
      role_id: roleId,
      username: username(user),
      avatar_storage_key: null,
      avatar_version: "0",
    };
  });
}

// Password hashes stay behind, as in every cutover: each user sets a new one.
// Avatars are blobs on the old deploy.
export function accountRows(users: readonly SourceRow[]): SourceRow[] {
  return users.map((user) => ({
    ...pick(user, ["id", ...PERSON, "created_at"]),
    username: username(user),
    password_hash: UNUSABLE_PASSWORD_HASH,
    password_change_required: "true",
    is_operator: "false",
    avatar_storage_key: null,
    avatar_mime_type: null,
    avatar_updated_at: null,
    avatar_version: "0",
  }));
}

export function membershipRows(
  users: readonly SourceRow[],
  workspaceId: string,
): SourceRow[] {
  return users.map((user) => ({
    account_id: field(user, "id"),
    workspace_id: workspaceId,
    created_at: field(user, "created_at"),
  }));
}

// work360 keeps a snapshot's file hash and uploader on the snapshot; the old
// deploy kept them on its file asset, which stays behind.
export function snapshotRows(
  snapshots: readonly SourceRow[],
  files: readonly SourceRow[],
): SourceRow[] {
  const byId = new Map(files.map((file) => [field(file, "id"), file]));
  return snapshots.map((snapshot) => {
    const file = byId.get(field(snapshot, "file_asset_id"));
    if (!file) {
      throw new Error("cutover_snapshot_file_missing");
    }
    return {
      ...pick(snapshot, [
        "id",
        "cut_at",
        "revision",
        "state",
        "uploaded_at",
        "activated_by",
        "activated_at",
      ]),
      content_sha256: field(file, "sha256_hex"),
      uploaded_by: field(file, "created_by_user_id"),
    };
  });
}

// The registry is shared; a workspace sees the records it subscribed to.
export function subscriptionRows(
  records: readonly SourceRow[],
  workspaceId: string,
): SourceRow[] {
  return records.map((record) => ({
    record_id: field(record, "id"),
    workspace_id: workspaceId,
    subscribed_at: field(record, "requested_at"),
  }));
}
