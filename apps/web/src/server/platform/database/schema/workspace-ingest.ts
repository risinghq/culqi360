// Engine ingest jobs the workspace follows. The engine owns each job; a row
// here says only when to read it next and when to stop following it.
export const WORKSPACE_INGEST: readonly string[] = [
  `create table ingest_watches (
    job_id text primary key not null,
    poll_at timestamptz not null,
    watch_until timestamptz not null
  )`,
  `create index idx_ingest_watches_poll_at on ingest_watches (poll_at)`,
];
