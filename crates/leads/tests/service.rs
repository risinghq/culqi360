use leads::contracts::{RecordCandidateRequest, RecordImportRequest, RecordImportRow};
use leads::service::{CandidateService, ImportService};
use shared::error::ApiError;

fn single_connection_pool() -> r2d2::Pool<r2d2_sqlite::SqliteConnectionManager> {
    // Each in-memory connection is its own database, so the pool holds one.
    r2d2::Pool::builder()
        .max_size(1)
        .build(r2d2_sqlite::SqliteConnectionManager::memory())
        .expect("pool")
}

fn import_one(pool: &r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>) {
    leads::validate_schema(&pool.get().expect("conn")).expect("schema");
    ImportService::new(pool.clone())
        .import_leads(&RecordImportRequest {
            rows: vec![RecordImportRow {
                ruc: "20100000001".into(),
                organization_name: "Org".into(),
                dni: "12345678".into(),
                person_name: "Alice".into(),
                phone_primary: "999111222".into(),
                quality_tier: Some(1),
                product_tag: None,
                branch_tag: None,
            }],
            source: "test".into(),
        })
        .expect("import");
}

// The web client sends its user, branch and team ids as UUIDs.
#[test]
fn candidates_accept_the_web_clients_uuid_ids() {
    let pool = single_connection_pool();
    import_one(&pool);
    let req: RecordCandidateRequest = serde_json::from_value(serde_json::json!({
        "branch_id": "01974fd5-f261-7a7d-93f5-2f3d0f960001",
        "user_id": "01974fd5-f261-7a7d-93f5-2f3d0f961001",
        "team_id": "01974fd5-f261-7a7d-93f5-2f3d0f962001",
        "amount": 5,
    }))
    .expect("request shape");

    let response = CandidateService::new(pool, 100)
        .candidates(&req)
        .expect("candidates");
    assert_eq!(response.count, 1);
}

#[test]
fn candidates_reject_an_id_that_is_not_a_uuid() {
    let pool = single_connection_pool();
    import_one(&pool);
    let req: RecordCandidateRequest = serde_json::from_value(serde_json::json!({
        "branch_id": "branch-1",
        "user_id": "01974fd5-f261-7a7d-93f5-2f3d0f961001",
    }))
    .expect("request shape");

    let err = CandidateService::new(pool, 100)
        .candidates(&req)
        .expect_err("a branch id must be a UUID");
    assert!(matches!(err, ApiError::Validation(_)));
}

#[test]
fn import_reports_a_storage_failure_as_a_service_error() {
    let pool = r2d2::Pool::new(r2d2_sqlite::SqliteConnectionManager::memory()).expect("pool");
    let service = ImportService::new(pool);
    let req = RecordImportRequest {
        rows: vec![RecordImportRow {
            ruc: "20100000001".into(),
            organization_name: "Org".into(),
            dni: "12345678".into(),
            person_name: "Alice".into(),
            phone_primary: "999111222".into(),
            quality_tier: Some(1),
            product_tag: None,
            branch_tag: None,
        }],
        source: "test".into(),
    };

    let err = service
        .import_leads(&req)
        .expect_err("a database without the leads table cannot accept rows");
    match err {
        ApiError::Service(message) => assert!(message.contains("insert failed")),
        other => panic!("unexpected error type: {other}"),
    }
}
