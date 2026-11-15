use crate::PipelineError;
use rusqlite::Connection;
use std::time::Duration;

pub fn open_rw(db_path: &str) -> Result<Connection, PipelineError> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA temp_store=MEMORY;
        PRAGMA cache_size=-262144;
        PRAGMA mmap_size=1073741824;
        PRAGMA wal_autocheckpoint=200000;
        PRAGMA foreign_keys=ON;
        "#,
    )?;
    conn.busy_timeout(Duration::from_secs(60))?;
    Ok(conn)
}

/// Deletes a database and its WAL/SHM sidecars. A leftover WAL would be
/// replayed into the next database created at this path, so it must go even
/// when the main file is already gone.
pub fn remove_db_files(db_path: &str) -> Result<(), PipelineError> {
    for suffix in ["", "-wal", "-shm"] {
        let path = format!("{db_path}{suffix}");
        if std::path::Path::new(&path).exists() {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

/// Build-database connection. A pipeline build is throwaway and has exactly
/// one writer: commits skip fsync (a crash means rebuild anyway), the lock is
/// taken once, and the WAL checkpoints little and often instead of one
/// 800 MB stall mid-commit. Checkpoint-on-close is kept: leaving the WAL on
/// disk makes the next connection pay a full WAL recovery scan (measured:
/// validate_secs went from ~0.1 s to 6-22 s per source at 1M rows).
pub fn open_rw_build(db_path: &str) -> Result<Connection, PipelineError> {
    let conn = open_rw(db_path)?;
    conn.execute_batch(
        r#"
        PRAGMA synchronous=OFF;
        PRAGMA locking_mode=EXCLUSIVE;
        PRAGMA cache_size=-1048576;
        -- A 1M A/B showed no benefit from a larger wal_autocheckpoint:
        -- doc-axis commit was 4.4 s at 8192 pages vs 4.5 s at 262144, so
        -- the default-sized WAL between checkpoints stays.
        PRAGMA wal_autocheckpoint=8192;
        "#,
    )?;
    Ok(conn)
}
