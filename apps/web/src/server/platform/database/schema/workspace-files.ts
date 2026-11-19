// Uploaded files. The bytes live in R2 under storage_key; a row here records
// what was checked about them.
export const WORKSPACE_FILES: readonly string[] = [
  `create table file_assets (
    id uuid primary key not null,
    storage_key text not null unique,
    purpose text not null,
    original_filename text not null,
    safe_display_filename text not null,
    detected_mime text not null,
    extension text not null,
    size_bytes integer not null,
    sha256_hex text not null,
    signature_kind text,
    scan_status text not null,
    scan_engine text,
    scan_reference text,
    created_by_user_id uuid not null references members(user_id),
    created_at timestamptz not null
  )`,
  `create index idx_file_assets_purpose_created on file_assets (purpose, created_at)`,

  `create table file_download_tokens (
    id uuid primary key not null,
    file_asset_id uuid not null references file_assets(id) on delete cascade,
    token_hash text not null unique,
    requested_by_user_id uuid not null references members(user_id),
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null
  )`,
];
