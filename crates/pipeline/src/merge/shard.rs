use crate::PipelineError;
use crate::merge::stats::{MergePhaseStats, StatementTimings};
use rusqlite::params;
use std::path::Path;
use std::time::Instant;

const MERGE_PREPARE_SQL: &str = include_str!("sql/merge_prepare.sql");
const MERGE_CORE_SQL: &str = include_str!("sql/merge_core.sql");
const MERGE_PHONE_SQL: &str = include_str!("sql/merge_phone.sql");
const MERGE_EMAIL_SQL: &str = include_str!("sql/merge_email.sql");
const MERGE_PHONE_STAGE_SQL: &str = include_str!("sql/merge_phone_stage.sql");
const MERGE_EMAIL_STAGE_SQL: &str = include_str!("sql/merge_email_stage.sql");
const MERGE_CLEANUP_SQL: &str = include_str!("sql/merge_cleanup.sql");

struct ShardMergeIds {
    source_id: i64,
    snapshot_id: i64,
    reliability_rank: i64,
}

type ShardMergeStep = fn(&rusqlite::Transaction<'_>, &ShardMergeIds) -> Result<(), PipelineError>;

/// The four steps where a live merge and a build merge differ. Live merges
/// must keep the phone/email tables and the row-hash ledger queryable
/// between snapshots, so they upsert into the indexed serving tables. A
/// build appends to unindexed staging tables instead; one GROUP BY pass in
/// finalize_build_merge_tables fills the serving tables after the last
/// source. The per-shard upsert probes into document_phone/company_phone
/// were the dominant full-build cost (5,914 s on osiptel's merge).
struct ShardMergeOps {
    create_row_delta: ShardMergeStep,
    merge_phones: ShardMergeStep,
    merge_emails: ShardMergeStep,
    update_row_ledger: ShardMergeStep,
}

fn create_row_delta_live(
    tx: &rusqlite::Transaction<'_>,
    ids: &ShardMergeIds,
) -> Result<(), PipelineError> {
    tx.execute(
        r#"
        CREATE TEMP TABLE tmp_row_delta AS
        SELECT ts.source_row_number, ts.raw_hash
        FROM tmp_stage ts
        LEFT JOIN source_row_hash_latest latest
            ON latest.source_id = ?1
           AND latest.source_row_number = ts.source_row_number
        WHERE latest.raw_hash IS NULL OR latest.raw_hash <> ts.raw_hash
        "#,
        [ids.source_id],
    )?;
    Ok(())
}

fn create_row_delta_build(
    tx: &rusqlite::Transaction<'_>,
    _ids: &ShardMergeIds,
) -> Result<(), PipelineError> {
    // A fresh build has no ledger rows for the source being merged, so
    // every staged row is a delta and the LEFT JOIN can only be wasted
    // probes (it was ~150-200 s on the large sources at full size).
    tx.execute(
        r#"
        CREATE TEMP TABLE tmp_row_delta AS
        SELECT ts.source_row_number, ts.raw_hash
        FROM tmp_stage ts
        "#,
        [],
    )?;
    Ok(())
}

fn merge_phones_live(
    tx: &rusqlite::Transaction<'_>,
    ids: &ShardMergeIds,
) -> Result<(), PipelineError> {
    let sql = MERGE_PHONE_SQL
        .replace("{snapshot_id}", &ids.snapshot_id.to_string())
        .replace("{reliability_rank}", &ids.reliability_rank.to_string());
    tx.execute_batch(&sql)?;
    Ok(())
}

fn merge_phones_build(
    tx: &rusqlite::Transaction<'_>,
    ids: &ShardMergeIds,
) -> Result<(), PipelineError> {
    let sql = MERGE_PHONE_STAGE_SQL
        .replace("{snapshot_id}", &ids.snapshot_id.to_string())
        .replace("{reliability_rank}", &ids.reliability_rank.to_string());
    tx.execute_batch(&sql)?;
    Ok(())
}

fn merge_emails_live(
    tx: &rusqlite::Transaction<'_>,
    ids: &ShardMergeIds,
) -> Result<(), PipelineError> {
    let sql = MERGE_EMAIL_SQL
        .replace("{source_id}", &ids.source_id.to_string())
        .replace("{reliability_rank}", &ids.reliability_rank.to_string())
        .replace("{snapshot_id}", &ids.snapshot_id.to_string());
    tx.execute_batch(&sql)?;
    Ok(())
}

fn merge_emails_build(
    tx: &rusqlite::Transaction<'_>,
    ids: &ShardMergeIds,
) -> Result<(), PipelineError> {
    let sql = MERGE_EMAIL_STAGE_SQL
        .replace("{source_id}", &ids.source_id.to_string())
        .replace("{reliability_rank}", &ids.reliability_rank.to_string())
        .replace("{snapshot_id}", &ids.snapshot_id.to_string());
    tx.execute_batch(&sql)?;
    Ok(())
}

fn update_row_ledger_live(
    tx: &rusqlite::Transaction<'_>,
    ids: &ShardMergeIds,
) -> Result<(), PipelineError> {
    tx.execute(
        r#"
        INSERT INTO source_row_hash_latest(
            source_id,
            source_row_number,
            raw_hash,
            updated_snapshot_id
        )
        SELECT
            ?1,
            ts.source_row_number,
            ts.raw_hash,
            ?2
        FROM tmp_stage ts
        JOIN tmp_row_delta delta ON delta.source_row_number = ts.source_row_number
        ON CONFLICT(source_id, source_row_number) DO UPDATE SET
            raw_hash = excluded.raw_hash,
            updated_snapshot_id = excluded.updated_snapshot_id
        "#,
        params![ids.source_id, ids.snapshot_id],
    )?;
    Ok(())
}

fn update_row_ledger_build(
    tx: &rusqlite::Transaction<'_>,
    ids: &ShardMergeIds,
) -> Result<(), PipelineError> {
    tx.execute(
        r#"
        INSERT INTO build_stage_row_hash(
            source_id,
            source_row_number,
            raw_hash,
            snapshot_id
        )
        SELECT
            ?1,
            ts.source_row_number,
            ts.raw_hash,
            ?2
        FROM tmp_stage ts
        "#,
        params![ids.source_id, ids.snapshot_id],
    )?;
    Ok(())
}

const LIVE_MERGE_OPS: ShardMergeOps = ShardMergeOps {
    create_row_delta: create_row_delta_live,
    merge_phones: merge_phones_live,
    merge_emails: merge_emails_live,
    update_row_ledger: update_row_ledger_live,
};

const BUILD_MERGE_OPS: ShardMergeOps = ShardMergeOps {
    create_row_delta: create_row_delta_build,
    merge_phones: merge_phones_build,
    merge_emails: merge_emails_build,
    update_row_ledger: update_row_ledger_build,
};

pub(super) fn merge_one_shard_live(
    main_conn: &mut rusqlite::Connection,
    shard_db_path: &Path,
    snapshot_id: i64,
) -> Result<MergePhaseStats, PipelineError> {
    merge_one_shard(main_conn, shard_db_path, snapshot_id, &LIVE_MERGE_OPS)
}

pub(super) fn merge_one_shard_build(
    main_conn: &mut rusqlite::Connection,
    shard_db_path: &Path,
    snapshot_id: i64,
) -> Result<MergePhaseStats, PipelineError> {
    merge_one_shard(main_conn, shard_db_path, snapshot_id, &BUILD_MERGE_OPS)
}

fn merge_one_shard(
    main_conn: &mut rusqlite::Connection,
    shard_db_path: &Path,
    snapshot_id: i64,
    ops: &ShardMergeOps,
) -> Result<MergePhaseStats, PipelineError> {
    let source_id: i64 = main_conn.query_row(
        "SELECT source_id FROM source_snapshot WHERE snapshot_id = ?1",
        [snapshot_id],
        |row| row.get(0),
    )?;
    let reliability_rank: i64 = main_conn.query_row(
        "SELECT reliability_rank FROM source_registry WHERE source_id = ?1",
        [source_id],
        |row| row.get(0),
    )?;
    let ids = ShardMergeIds {
        source_id,
        snapshot_id,
        reliability_rank,
    };

    let tx = main_conn.transaction()?;
    let shard_path = shard_db_path.to_string_lossy().to_string();
    let mut stats = MergePhaseStats::default();

    let t = Instant::now();
    tx.execute("ATTACH DATABASE ?1 AS shard", params![shard_path])?;
    stats.attach_detach_secs += t.elapsed().as_secs_f64();

    let timings = &mut stats.statements;
    let t = Instant::now();
    timings.execute_batch(&tx, "prepare", MERGE_PREPARE_SQL)?;
    run_timed_step(&tx, &ids, "row_delta", ops.create_row_delta, timings)?;
    timings.execute_batch(
        &tx,
        "row_delta_index",
        "CREATE INDEX tmp_row_delta_source_row_idx ON tmp_row_delta(source_row_number)",
    )?;
    stats.prepare_secs = t.elapsed().as_secs_f64();

    let merge_core_sql =
        MERGE_CORE_SQL.replace("{reliability_rank}", &ids.reliability_rank.to_string());
    let t = Instant::now();
    timings.execute_batch(&tx, "core", &merge_core_sql)?;
    stats.core_secs = t.elapsed().as_secs_f64();

    let t = Instant::now();
    run_timed_step(&tx, &ids, "phone", ops.merge_phones, timings)?;
    stats.phone_secs = t.elapsed().as_secs_f64();

    let t = Instant::now();
    run_timed_step(&tx, &ids, "email", ops.merge_emails, timings)?;
    stats.email_secs = t.elapsed().as_secs_f64();

    let t = Instant::now();
    timings.execute_batch(
        &tx,
        "dirty",
        r#"
        INSERT OR IGNORE INTO projection_dirty_doc(doc_id)
        SELECT DISTINCT rf.doc_id
        FROM tmp_resolved_facts rf
        JOIN tmp_row_delta delta ON delta.source_row_number = rf.source_row_number
        WHERE rf.doc_id IS NOT NULL;

        -- CROSS JOIN pins the shard's companies as the outer loop, so each
        -- probes company_role's unique index (company_id leads it). Without
        -- statistics the planner scanned all of company_role per shard,
        -- 10-13 s per source at full size, even for a source with no roles.
        INSERT OR IGNORE INTO projection_dirty_doc(doc_id)
        SELECT DISTINCT cr.doc_id
        FROM (
            SELECT DISTINCT rf.company_id
            FROM tmp_resolved_facts rf
            JOIN tmp_row_delta delta ON delta.source_row_number = rf.source_row_number
            WHERE rf.company_id IS NOT NULL
        ) dirty_company
        CROSS JOIN company_role cr ON cr.company_id = dirty_company.company_id
        WHERE cr.doc_id IS NOT NULL;

        INSERT OR IGNORE INTO projection_dirty_company(company_id)
        SELECT DISTINCT rf.company_id
        FROM tmp_resolved_facts rf
        JOIN tmp_row_delta delta ON delta.source_row_number = rf.source_row_number
        WHERE rf.company_id IS NOT NULL;
        "#,
    )?;
    // The engine's upload path reads source_row_hash_latest on the
    // promoted database to dedupe re-uploads, so a build must ship the
    // ledger too. Like phones and emails it is staged unindexed, and one
    // ordered insert per source (merge::collapse_source_ledger) fills the
    // ledger; the per-shard insert into the indexed table cost ~1,100 s on the
    // full build. Live ingest keeps the upsert because earlier snapshots
    // leave rows behind.
    run_timed_step(&tx, &ids, "ledger", ops.update_row_ledger, timings)?;
    stats.core_secs += t.elapsed().as_secs_f64();

    let t = Instant::now();
    tx.execute_batch(MERGE_CLEANUP_SQL)?;
    stats.cleanup_secs = t.elapsed().as_secs_f64();

    let t = Instant::now();
    tx.commit()?;
    stats.commit_secs = t.elapsed().as_secs_f64();

    let t = Instant::now();
    main_conn.execute("DETACH DATABASE shard", [])?;
    stats.attach_detach_secs += t.elapsed().as_secs_f64();

    Ok(stats)
}

fn run_timed_step(
    tx: &rusqlite::Transaction<'_>,
    ids: &ShardMergeIds,
    step: &str,
    run: ShardMergeStep,
    timings: &mut StatementTimings,
) -> Result<(), PipelineError> {
    let started_at = Instant::now();
    run(tx, ids)?;
    timings.record(step, started_at.elapsed().as_secs_f64());
    Ok(())
}
