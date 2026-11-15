//! Merge staged shard rows into the durable pipeline store.
//!
//! The merge capability owns snapshot state, merge metrics, and shard SQL
//! execution. Callers provide a completed ingest session and receive phase
//! timings for orchestration logs.

mod metrics;
mod shard;
pub mod snapshot;
pub mod stats;

use crate::PipelineError;
use crate::ingest::IngestSession;
use crate::storage::db::{open_rw, open_rw_build};
use metrics::persist_metrics;
use snapshot::{mark_snapshot_failed, set_snapshot_status};
use stats::MergePhaseStats;

/// Live-ingest merge (engine uploads). Maintains the row-hash ledger so the
/// next upload of the same source only re-merges changed rows.
pub fn merge_ingest_session(
    db_path: &str,
    session: IngestSession,
) -> Result<MergePhaseStats, PipelineError> {
    let conn = open_rw(db_path)?;
    merge_session(db_path, conn, session, shard::merge_one_shard_live)
}

/// Offline build merge. Phone, email and ledger rows stage unindexed and
/// one sorted bulk pass in finalize_build_merge_tables fills the durable
/// tables, so per-shard merges never probe an indexed table.
pub fn merge_ingest_session_for_build(
    db_path: &str,
    session: IngestSession,
) -> Result<MergePhaseStats, PipelineError> {
    let conn = open_rw_build(db_path)?;
    merge_session(db_path, conn, session, shard::merge_one_shard_build)
}

fn merge_session(
    db_path: &str,
    mut conn: rusqlite::Connection,
    session: IngestSession,
    merge_shard: fn(
        &mut rusqlite::Connection,
        &std::path::Path,
        i64,
    ) -> Result<MergePhaseStats, PipelineError>,
) -> Result<MergePhaseStats, PipelineError> {
    let mut stats = MergePhaseStats::default();

    for shard_result in session.shard_results.iter() {
        let shard_stats = merge_shard(&mut conn, &shard_result.shard_db_path, session.snapshot_id)?;
        stats.prepare_secs += shard_stats.prepare_secs;
        stats.core_secs += shard_stats.core_secs;
        stats.phone_secs += shard_stats.phone_secs;
        stats.email_secs += shard_stats.email_secs;
        stats.cleanup_secs += shard_stats.cleanup_secs;
        stats.attach_detach_secs += shard_stats.attach_detach_secs;
        stats.commit_secs += shard_stats.commit_secs;
    }

    if session.dispatched_rows != session.counters.total_rows {
        return Err(fail_snapshot(
            db_path,
            session.snapshot_id,
            PipelineError::Args(format!(
                "sharded ingest row mismatch source={} dispatched={} merged_total={}",
                session.source_key, session.dispatched_rows, session.counters.total_rows
            )),
        ));
    }

    let finalize_started_at = std::time::Instant::now();
    let tx = conn.transaction()?;
    persist_metrics(&tx, session.snapshot_id, &session.counters)?;
    set_snapshot_status(&tx, session.snapshot_id, "merged")?;
    tx.commit()?;
    stats.finalize_secs = finalize_started_at.elapsed().as_secs_f64();

    println!(
        "{{\"snapshot_id\":{},\"total_rows\":{},\"accepted_rows\":{},\"invalid_doc_rows\":{},\"invalid_ruc_rows\":{},\"invalid_phone_rows\":{}}}",
        session.snapshot_id,
        session.counters.total_rows,
        session.counters.accepted_rows,
        session.counters.invalid_doc_rows,
        session.counters.invalid_ruc_rows,
        session.counters.invalid_phone_rows
    );
    Ok(stats)
}

/// Collapses the per-source phone/email staging rows into the serving tables
/// in one sorted pass. Must run before the post-merge indexes exist, so the
/// bulk inserts never maintain a secondary index. Requires the build schema:
/// init_schema does not create the build_stage_* tables, so on a live
/// database this fails with 'no such table'. The batch runs in one
/// transaction so a failure leaves no partly filled serving tables.
pub fn finalize_build_merge_tables(conn: &mut rusqlite::Connection) -> Result<(), PipelineError> {
    let tx = conn.transaction()?;
    tx.execute_batch(
        r#"
        INSERT INTO document_phone(
            doc_id,
            phone,
            first_seen_snapshot_id,
            last_seen_snapshot_id,
            confidence
        )
        SELECT
            doc_id,
            phone,
            MIN(snapshot_id),
            MAX(snapshot_id),
            MAX(confidence)
        FROM build_stage_phone
        WHERE doc_id IS NOT NULL
        GROUP BY doc_id, phone
        ORDER BY doc_id, phone;

        INSERT INTO company_phone(
            company_id,
            phone,
            first_seen_snapshot_id,
            last_seen_snapshot_id,
            confidence
        )
        SELECT
            company_id,
            phone,
            MIN(snapshot_id),
            MAX(snapshot_id),
            MAX(confidence)
        FROM build_stage_phone
        WHERE doc_id IS NULL
        GROUP BY company_id, phone
        ORDER BY company_id, phone;

        -- Live upsert semantics: MAX(reliability) wins, and an equal-reliability
        -- newer snapshot replaces source_id. Merge order is snapshot order, so
        -- the winner is the row with the highest (reliability, snapshot_id).
        INSERT INTO document_email(doc_id, email, source_id, reliability)
        SELECT doc_id, email, source_id, reliability
        FROM (
            SELECT
                doc_id,
                email,
                source_id,
                reliability,
                ROW_NUMBER() OVER (
                    PARTITION BY doc_id, email
                    ORDER BY reliability DESC, snapshot_id DESC
                ) AS rn
            FROM build_stage_email
        )
        WHERE rn = 1
        ORDER BY doc_id, email;

        -- The dispatcher assigns source_row_number uniquely per source,
        -- so within a snapshot no (source_id, source_row_number) pair can
        -- repeat; the ordered insert is equivalent to the live upsert's
        -- last-write-wins because there is never a second write.
        INSERT INTO source_row_hash_latest(
            source_id,
            source_row_number,
            raw_hash,
            updated_snapshot_id
        )
        SELECT source_id, source_row_number, raw_hash, snapshot_id
        FROM build_stage_row_hash
        ORDER BY source_id, source_row_number;

        DROP TABLE IF EXISTS build_stage_phone;
        DROP TABLE IF EXISTS build_stage_email;
        DROP TABLE IF EXISTS build_stage_row_hash;
        "#,
    )?;
    tx.commit()?;
    Ok(())
}

pub fn fail_snapshot(db_path: &str, snapshot_id: i64, err: PipelineError) -> PipelineError {
    if let Err(update_err) = mark_snapshot_failed(db_path, snapshot_id) {
        eprintln!(
            "[pipeline] warning: could not record snapshot {snapshot_id} failure in db: {update_err}"
        );
    }
    err
}
