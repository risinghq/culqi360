use pipeline::ingest::{IngestCounters, IngestSession, ShardResult};
use pipeline::merge::{
    finalize_build_merge_tables, merge_ingest_session, merge_ingest_session_for_build,
};
use pipeline::storage::db::open_rw;
use pipeline::storage::schema::{init_schema, init_schema_for_build};
use rusqlite::{Connection, params};
use std::path::PathBuf;

/// stage_rows mirrors crates/pipeline/src/ingest/worker.rs.
fn write_shard_db(path: &PathBuf, rows: &[&str]) {
    let conn = Connection::open(path).expect("open shard");
    conn.execute_batch(
        "CREATE TABLE stage_rows (
            source_row_number INTEGER NOT NULL,
            person_dni TEXT,
            person_natural_ruc TEXT,
            person_full_name TEXT NOT NULL,
            email TEXT,
            company_ruc TEXT,
            company_name TEXT NOT NULL,
            role_name TEXT NOT NULL,
            role_start_date TEXT NOT NULL,
            rep_doc_type TEXT NOT NULL,
            rep_doc_number TEXT NOT NULL,
            rep_name TEXT NOT NULL,
            phones_json TEXT NOT NULL,
            had_phone_input INTEGER NOT NULL,
            raw_hash TEXT NOT NULL,
            company_status TEXT NOT NULL,
            company_condition TEXT NOT NULL,
            company_type TEXT NOT NULL,
            economic_activity TEXT NOT NULL,
            company_ubigeo TEXT NOT NULL,
            company_department TEXT NOT NULL,
            company_province TEXT NOT NULL,
            company_district TEXT NOT NULL
        )",
    )
    .expect("create stage_rows");
    for row in rows {
        conn.execute_batch(row).expect("insert stage row");
    }
}

fn seed_source(db_path: &str, source_id: i64, snapshot_id: i64, key: &str, rank: i64) {
    let conn = open_rw(db_path).expect("open db");
    conn.execute(
        "INSERT INTO source_registry(source_id, source_key, source_name, reliability_rank)
         VALUES (?1, ?2, ?2, ?3)",
        params![source_id, key, rank],
    )
    .expect("registry");
    conn.execute(
        "INSERT INTO source_snapshot(snapshot_id, source_id, snapshot_label, snapshot_date, file_path, status)
         VALUES (?1, ?2, ?3, '2026-01-01', 'x.csv', 'loading')",
        params![snapshot_id, source_id, key],
    )
    .expect("snapshot");
}

fn session(snapshot_id: i64, source_key: &str, shard_db_path: PathBuf, rows: i64) -> IngestSession {
    IngestSession {
        snapshot_id,
        source_key: source_key.to_owned(),
        counters: IngestCounters {
            total_rows: rows,
            accepted_rows: rows,
            invalid_doc_rows: 0,
            invalid_ruc_rows: 0,
            invalid_phone_rows: 0,
        },
        dispatched_rows: rows,
        dispatch_secs: 0.0,
        worker_join_secs: 0.0,
        run_root: PathBuf::new(),
        shard_results: vec![ShardResult {
            shard_index: 0,
            shard_db_path,
        }],
    }
}

fn dump(conn: &Connection, sql: &str) -> Vec<Vec<String>> {
    conn.prepare(sql)
        .expect("prepare")
        .query_map([], |row| {
            let mut values = Vec::new();
            for i in 0..row.as_ref().column_count() {
                let value: rusqlite::types::Value = row.get(i)?;
                values.push(format!("{value:?}"));
            }
            Ok(values)
        })
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("collect")
}

#[test]
fn staged_merge_matches_live_merge_rows() {
    let dir = tempfile::tempdir().expect("tempdir");

    // Two overlapping sources: same doc + ruc, different phone/email/rank.
    let shard_a = dir.path().join("a.sqlite");
    let shard_b = dir.path().join("b.sqlite");
    write_shard_db(
        &shard_a,
        &[
            "INSERT INTO stage_rows VALUES (
                1,'DNI','12345678','PERSON A','a@x.com','201','ACME','GERENTE','2020-01-01',
                'DNI','12345678','REP A','[\"999111222\"]',1,'h1','ACTIVO','HABIDO','SAC','COM','15','LIM','LIM','LIM'
            )",
            "INSERT INTO stage_rows VALUES (
                2,'DNI','87654321','PERSON B',NULL,'201','ACME','SOCIO','',
                'DNI','87654321','REP B','[]',0,'h2','ACTIVO','HABIDO','SAC','COM','15','LIM','LIM','LIM'
            )",
        ],
    );
    write_shard_db(
        &shard_b,
        &["INSERT INTO stage_rows VALUES (
            1,'DNI','12345678','PERSON A','a@x.com','201','ACME','GERENTE','2020-01-01',
            'DNI','12345678','REP A','[\"999111222\",\"888777666\"]',1,'h3','ACTIVO','HABIDO','SAC','COM','15','LIM','LIM','LIM'
        )"],
    );

    let live_db = dir.path().join("live.sqlite").to_string_lossy().to_string();
    let build_db = dir
        .path()
        .join("build.sqlite")
        .to_string_lossy()
        .to_string();
    init_schema(&live_db).expect("live schema");
    init_schema_for_build(&build_db).expect("build schema");

    for db in [&live_db, &build_db] {
        seed_source(db, 1, 1, "s1", 10);
        seed_source(db, 2, 2, "s2", 20);
    }

    merge_ingest_session(&live_db, session(1, "s1", shard_a.clone(), 2)).expect("live merge 1");
    merge_ingest_session(&live_db, session(2, "s2", shard_b.clone(), 1)).expect("live merge 2");
    merge_ingest_session_for_build(&build_db, session(1, "s1", shard_a, 2)).expect("build merge 1");
    merge_ingest_session_for_build(&build_db, session(2, "s2", shard_b, 1)).expect("build merge 2");

    let live = open_rw(&live_db).expect("live conn");
    let mut build = open_rw(&build_db).expect("build conn");
    finalize_build_merge_tables(&mut build).expect("finalize build");

    for table in [
        "document_phone",
        "company_phone",
        "document_email",
        "source_row_hash_latest",
    ] {
        let mut live_rows = dump(&live, &format!("SELECT * FROM {table}"));
        let mut build_rows = dump(&build, &format!("SELECT * FROM {table}"));
        live_rows.sort();
        build_rows.sort();
        assert_eq!(live_rows, build_rows, "{table} differs");
    }
}
