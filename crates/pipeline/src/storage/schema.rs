//! Durable SQLite schema for staged and serving pipeline data.

use crate::PipelineError;
use crate::storage::db::open_rw;

/// Full schema for a database that is read between merges (live ingest, engine
/// staged DBs). Creates every index up front.
pub fn init_schema(db_path: &str) -> Result<(), PipelineError> {
    let conn = open_rw(db_path)?;
    create_schema(&conn)?;
    create_post_merge_indexes(&conn)?;
    create_serving_indexes(&conn)?;
    Ok(())
}

/// Build schema. A build writes every merge table before anything reads them,
/// so the secondary indexes merge never probes are deferred until materialize:
/// they are built once from sorted data instead of maintained across every
/// merge upsert. On osiptel's full merge (36M rows) index maintenance on
/// document_phone/company_phone was a measurable share of 5914s merge_phone.
pub fn init_schema_for_build(db_path: &str) -> Result<(), PipelineError> {
    let conn = crate::storage::db::open_rw_build(db_path)?;
    create_schema(&conn)?;
    conn.execute_batch(
        r#"
        -- Unindexed append targets for phone/email merges during a build.
        -- finalize_build_merge_tables drains them into the serving tables.
        CREATE TABLE IF NOT EXISTS build_stage_phone (
            doc_id INTEGER,
            company_id INTEGER,
            phone TEXT NOT NULL,
            snapshot_id INTEGER NOT NULL,
            confidence INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS build_stage_email (
            doc_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            reliability INTEGER NOT NULL,
            snapshot_id INTEGER NOT NULL
        );

        -- Same pattern for the row-hash ledger: appends here are cheap,
        -- and once a source's shards are merged one ordered insert moves
        -- its rows into source_row_hash_latest, which the engine's upload
        -- path reads.
        CREATE TABLE IF NOT EXISTS build_stage_row_hash (
            source_id INTEGER NOT NULL,
            source_row_number INTEGER NOT NULL,
            raw_hash BLOB NOT NULL,
            snapshot_id INTEGER NOT NULL
        );
        "#,
    )?;
    Ok(())
}

/// Indexes merge does not read but materialize's ranked queries do. Called by
/// the build path after all source merges, before materialize. IF NOT EXISTS
/// makes it idempotent.
pub fn create_post_merge_indexes(conn: &rusqlite::Connection) -> Result<(), PipelineError> {
    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_company_role_doc_id
            ON company_role(doc_id);

        CREATE INDEX IF NOT EXISTS idx_company_role_company_id
            ON company_role(company_id);

        CREATE INDEX IF NOT EXISTS idx_document_phone_doc_id
            ON document_phone(doc_id, confidence DESC, phone);

        CREATE INDEX IF NOT EXISTS idx_document_email_doc_id
            ON document_email(doc_id, reliability DESC, email);
        "#,
    )?;
    Ok(())
}

/// Pure serving indexes: materialize reads these tables by their primary key,
/// so nothing inside the pipeline probes them. Called by the build path after
/// materialize. IF NOT EXISTS makes it idempotent.
///
/// The phone-index keys are unique so a refresh's INSERT OR IGNORE keeps
/// one row per (phone, id). In a build each id is materialized once, so the
/// rows are already unique and the key is sorted once here. Kept on the table
/// while the drain ran, the key took random inserts across every phone merged
/// so far: 650 s of the full build's doc drain.
pub fn create_serving_indexes(conn: &rusqlite::Connection) -> Result<(), PipelineError> {
    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_doc_projection_doc
            ON doc_projection(doc_number);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_projection_phone_index_key
            ON doc_projection_phone_index(phone, doc_id);

        CREATE INDEX IF NOT EXISTS idx_company_projection_ruc
            ON company_projection(ruc);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_company_projection_phone_index_key
            ON company_projection_phone_index(phone, company_id);

        CREATE INDEX IF NOT EXISTS idx_company_phone_phone
            ON company_phone(phone);
        "#,
    )?;
    Ok(())
}

fn create_schema(conn: &rusqlite::Connection) -> Result<(), PipelineError> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA temp_store=MEMORY;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS source_registry (
            source_id INTEGER PRIMARY KEY,
            source_key TEXT NOT NULL UNIQUE,
            source_name TEXT NOT NULL,
            reliability_rank INTEGER NOT NULL DEFAULT 100,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS source_snapshot (
            snapshot_id INTEGER PRIMARY KEY,
            source_id INTEGER NOT NULL,
            snapshot_label TEXT NOT NULL,
            snapshot_date TEXT NOT NULL,
            file_path TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'registered',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(source_id, snapshot_label),
            FOREIGN KEY(source_id) REFERENCES source_registry(source_id)
        );

        CREATE TABLE IF NOT EXISTS document (
            doc_id INTEGER PRIMARY KEY,
            doc_type TEXT NOT NULL,
            doc_number TEXT NOT NULL,
            UNIQUE(doc_type, doc_number)
        );

        CREATE TABLE IF NOT EXISTS document_attribute (
            doc_id INTEGER PRIMARY KEY,
            full_name TEXT NOT NULL DEFAULT '',
            full_name_rank INTEGER NOT NULL DEFAULT 0,
            birth_date TEXT,
            birth_place TEXT,
            sex TEXT,
            marital_status TEXT,
            location_text TEXT,
            mother_name TEXT,
            father_name TEXT,
            ubigeo_code TEXT,
            natural_ruc10 TEXT,
            FOREIGN KEY(doc_id) REFERENCES document(doc_id)
        );

        CREATE TABLE IF NOT EXISTS company (
            company_id INTEGER PRIMARY KEY,
            ruc TEXT NOT NULL UNIQUE,
            legal_name TEXT NOT NULL DEFAULT '',
            legal_name_rank INTEGER NOT NULL DEFAULT 0,
            trade_name TEXT,
            registration_date TEXT,
            activity_start_date TEXT,
            fiscal_address TEXT,
            company_type TEXT,
            line_of_business TEXT,
            status TEXT,
            condition TEXT,
            ubigeo_code TEXT,
            department TEXT,
            province TEXT,
            district TEXT,
            economic_activity TEXT
        );

        CREATE TABLE IF NOT EXISTS company_role (
            role_id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            doc_id INTEGER,
            rep_doc_type TEXT NOT NULL DEFAULT '',
            rep_doc_number TEXT NOT NULL DEFAULT '',
            rep_name TEXT NOT NULL DEFAULT '',
            rep_name_rank INTEGER NOT NULL DEFAULT 0,
            role_name TEXT NOT NULL DEFAULT '',
            role_start_date TEXT NOT NULL DEFAULT '',
            UNIQUE(company_id, rep_doc_type, rep_doc_number, role_name, role_start_date),
            FOREIGN KEY(company_id) REFERENCES company(company_id),
            FOREIGN KEY(doc_id) REFERENCES document(doc_id)
        );

        CREATE TABLE IF NOT EXISTS document_phone (
            doc_id INTEGER NOT NULL,
            phone TEXT NOT NULL,
            first_seen_snapshot_id INTEGER NOT NULL,
            last_seen_snapshot_id INTEGER NOT NULL,
            confidence INTEGER NOT NULL DEFAULT 100,
            PRIMARY KEY(doc_id, phone),
            FOREIGN KEY(doc_id) REFERENCES document(doc_id)
        );

        CREATE TABLE IF NOT EXISTS document_email (
            doc_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            reliability INTEGER NOT NULL,
            PRIMARY KEY(doc_id, email),
            FOREIGN KEY(doc_id) REFERENCES document(doc_id),
            FOREIGN KEY(source_id) REFERENCES source_registry(source_id)
        );

        CREATE TABLE IF NOT EXISTS company_phone (
            company_id INTEGER NOT NULL,
            phone TEXT NOT NULL,
            first_seen_snapshot_id INTEGER NOT NULL,
            last_seen_snapshot_id INTEGER NOT NULL,
            confidence INTEGER NOT NULL DEFAULT 100,
            PRIMARY KEY(company_id, phone),
            FOREIGN KEY(company_id) REFERENCES company(company_id)
        );

        CREATE TABLE IF NOT EXISTS snapshot_metrics (
            snapshot_id INTEGER PRIMARY KEY,
            total_rows INTEGER NOT NULL DEFAULT 0,
            accepted_rows INTEGER NOT NULL DEFAULT 0,
            invalid_doc_rows INTEGER NOT NULL DEFAULT 0,
            invalid_ruc_rows INTEGER NOT NULL DEFAULT 0,
            invalid_phone_rows INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(snapshot_id) REFERENCES source_snapshot(snapshot_id)
        );

        CREATE TABLE IF NOT EXISTS source_row_hash_latest (
            source_id INTEGER NOT NULL,
            source_row_number INTEGER NOT NULL,
            raw_hash TEXT NOT NULL,
            updated_snapshot_id INTEGER NOT NULL,
            PRIMARY KEY(source_id, source_row_number),
            FOREIGN KEY(source_id) REFERENCES source_registry(source_id),
            FOREIGN KEY(updated_snapshot_id) REFERENCES source_snapshot(snapshot_id)
        );

        CREATE TABLE IF NOT EXISTS projection_dirty_doc (
            doc_id INTEGER PRIMARY KEY,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(doc_id) REFERENCES document(doc_id)
        );

        CREATE TABLE IF NOT EXISTS projection_dirty_company (
            company_id INTEGER PRIMARY KEY,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(company_id) REFERENCES company(company_id)
        );

        CREATE TABLE IF NOT EXISTS ruc_phone_agg (
            org_ruc TEXT PRIMARY KEY,
            phones TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS doc_phone_agg (
            doc_id INTEGER PRIMARY KEY,
            phones TEXT NOT NULL,
            FOREIGN KEY(doc_id) REFERENCES document(doc_id)
        );

        CREATE TABLE IF NOT EXISTS doc_projection (
            doc_id INTEGER PRIMARY KEY,
            doc_type TEXT NOT NULL,
            doc_number TEXT NOT NULL,
            name TEXT,
            birth_date TEXT,
            birth_place TEXT,
            sex TEXT,
            marital_status TEXT,
            location_text TEXT,
            ubigeo_code TEXT,
            mother_name TEXT,
            father_name TEXT,
            email TEXT,
            person_ruc TEXT,
            org_ruc TEXT,
            org_name TEXT,
            trade_name TEXT,
            company_type TEXT,
            org_status TEXT,
            org_condition TEXT,
            fiscal_address TEXT,
            registration_date TEXT,
            activity_start_date TEXT,
            line_of_business TEXT,
            economic_activity TEXT,
            org_ubigeo_code TEXT,
            org_department TEXT,
            org_province TEXT,
            org_district TEXT,
            role_name TEXT,
            role_start_date TEXT,
            rep_doc_type TEXT,
            rep_doc_number TEXT,
            rep_name TEXT,
            phone_primary TEXT,
            phone_secondary TEXT,
            FOREIGN KEY(doc_id) REFERENCES document(doc_id)
        );

        CREATE TABLE IF NOT EXISTS company_projection (
            company_id INTEGER PRIMARY KEY,
            ruc TEXT NOT NULL,
            legal_name TEXT,
            trade_name TEXT,
            company_type TEXT,
            org_status TEXT,
            org_condition TEXT,
            fiscal_address TEXT,
            registration_date TEXT,
            activity_start_date TEXT,
            line_of_business TEXT,
            economic_activity TEXT,
            org_ubigeo_code TEXT,
            org_department TEXT,
            org_province TEXT,
            org_district TEXT,
            phone_primary TEXT,
            phone_secondary TEXT,
            FOREIGN KEY(company_id) REFERENCES company(company_id)
        );

        -- The people a company search result lists, best-ranked first.
        -- `position` is the rank within the company (1 = primary representative).
        CREATE TABLE IF NOT EXISTS company_people_projection (
            company_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            doc_type TEXT,
            doc_number TEXT,
            name TEXT,
            role_name TEXT,
            role_start_date TEXT,
            PRIMARY KEY(company_id, position),
            FOREIGN KEY(company_id) REFERENCES company(company_id)
        ) WITHOUT ROWID;

        -- Their unique (phone, id) keys are serving indexes, so a build
        -- appends rows in id order and sorts them once at the end.
        CREATE TABLE IF NOT EXISTS doc_projection_phone_index (
            phone TEXT NOT NULL,
            doc_id INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS company_projection_phone_index (
            phone TEXT NOT NULL,
            company_id INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS doc_projection_fts USING fts5(
            doc_name,
            tokenize="unicode61 remove_diacritics 1"
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS company_projection_fts USING fts5(
            company_name,
            tokenize="unicode61 remove_diacritics 1"
        );

        CREATE TABLE IF NOT EXISTS _pipeline_build (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )?;

    Ok(())
}
