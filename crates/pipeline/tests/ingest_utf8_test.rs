use pipeline::config::mapping::{SourceEncoding, SourceMapping};
use pipeline::ingest::{ShardIngestConfig, ingest_to_shards};
use pipeline::storage::schema::init_schema;
use std::collections::HashMap;
use std::io::Write;

fn utf8_mapping() -> SourceMapping {
    SourceMapping {
        source_key: "test_source".to_owned(),
        source_name: "test_source".to_owned(),
        reliability_rank: 85,
        delimiter: ",".to_owned(),
        has_header: true,
        flexible: true,
        fields: HashMap::new(),
        phone_columns: Vec::new(),
        phone_prefixes: Vec::new(),
        encoding: SourceEncoding::Utf8,
        doc_type_map: HashMap::new(),
    }
}

/// A worker that dies on a bad byte makes the next dispatcher send fail with
/// a generic send error; the surfaced error must still be the worker's real
/// decode failure. The bad row comes first and is followed by more rows than
/// the 4096-slot worker channel can hold, so the worker dies, drops its
/// receiver and leaves the dispatcher blocked on a full channel: the send
/// fails every time and the dispatch-error branch is exercised.
#[test]
fn a_bad_byte_under_utf8_encoding_surfaces_the_decode_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir
        .path()
        .join("stage.sqlite")
        .to_string_lossy()
        .to_string();
    init_schema(&db_path).expect("init schema");

    let csv_path = dir.path().join("input.csv");
    let mut file = std::fs::File::create(&csv_path).expect("create csv");
    file.write_all(b"doc_number,name\n").expect("header");
    file.write_all(b"99999999,BAD \xD1 NAME\n")
        .expect("bad row");
    for i in 0..10_000 {
        file.write_all(format!("{i:08},NAME {i}\n").as_bytes())
            .expect("row");
    }

    let mapping = utf8_mapping();
    let result = ingest_to_shards(ShardIngestConfig {
        db_path: &db_path,
        run_id: "test-run",
        mapping: &mapping,
        input_path: csv_path.to_str().expect("utf8 path"),
        snapshot_label: "test-snap",
        snapshot_date: "2026-01-01",
        batch_size: 10,
        workers: 1,
        max_rows: 20_000,
    });

    let Err(err) = result else {
        panic!("bad utf-8 byte must fail ingest");
    };
    assert!(
        err.to_string().contains("invalid utf-8 for source"),
        "expected decode error, got: {err}"
    );
}
