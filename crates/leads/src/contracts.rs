use serde::Deserialize;

// Generated struct types are re-exported here so callers only import from
// `leads::contracts`, never from the generated module directly.
pub use crate::contracts_generated::{
    RecordCandidate, RecordCandidatesResponse, RecordImportRequest, RecordImportResponse,
    RecordImportRow,
};

// The ids are the web app's UUIDs. The service parses them.
#[derive(Debug, Deserialize)]
pub struct RecordCandidateRequest {
    pub branch_id: String,
    pub user_id: String,
    #[serde(default = "default_amount")]
    pub amount: usize,
    pub team_id: Option<String>,
    pub product_id: Option<i64>,
    #[serde(default)]
    pub strategy: CandidateStrategy,
}

#[derive(Debug, Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "snake_case")]
pub enum CandidateStrategy {
    #[default]
    Balanced,
    Freshness,
    Conversion,
}

fn default_amount() -> usize {
    20
}
