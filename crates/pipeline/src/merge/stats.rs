use crate::PipelineError;
use rusqlite::fallible_iterator::FallibleIterator;
use std::time::Instant;

#[derive(Default, Clone)]
pub struct MergePhaseStats {
    pub prepare_secs: f64,
    pub core_secs: f64,
    pub phone_secs: f64,
    pub email_secs: f64,
    pub cleanup_secs: f64,
    pub attach_detach_secs: f64,
    pub commit_secs: f64,
    pub finalize_secs: f64,
    pub statements: StatementTimings,
}

/// Wall time per merge statement, summed over a source's shards. A label is
/// the step name and the statement's position in that step's SQL, so a run
/// shows which statement's cost grows with the global tables.
#[derive(Default, Clone)]
pub struct StatementTimings(Vec<(String, f64)>);

impl StatementTimings {
    pub fn record(&mut self, label: &str, secs: f64) {
        if let Some(entry) = self.0.iter_mut().find(|(key, _)| key == label) {
            entry.1 += secs;
        } else {
            self.0.push((label.to_owned(), secs));
        }
    }

    /// Runs each statement of a batch on its own so its wall time is
    /// recorded under `{step}.{position}`. SQLite splits the batch, as
    /// execute_batch does.
    pub fn execute_batch(
        &mut self,
        conn: &rusqlite::Connection,
        step: &str,
        sql: &str,
    ) -> Result<(), PipelineError> {
        let mut batch = rusqlite::Batch::new(conn, sql);
        let mut position = 0;
        while let Some(mut statement) = batch.next()? {
            position += 1;
            let started_at = Instant::now();
            statement.raw_execute()?;
            self.record(
                &format!("{step}.{position}"),
                started_at.elapsed().as_secs_f64(),
            );
        }
        Ok(())
    }

    pub fn add_from(&mut self, other: &StatementTimings) {
        for (label, secs) in &other.0 {
            self.record(label, *secs);
        }
    }

    pub fn format(&self) -> String {
        self.0
            .iter()
            .map(|(label, secs)| format!("{label}={secs:.3}"))
            .collect::<Vec<_>>()
            .join(" ")
    }
}
