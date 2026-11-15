-- Build mode: append resolved emails to the unindexed staging table. The
-- finalize pass keeps the highest-reliability row per (doc_id, email),
-- matching the live upsert's MAX(reliability) / newer-write-wins tiebreak.
INSERT INTO build_stage_email(doc_id, email, source_id, reliability, snapshot_id)
SELECT DISTINCT
    rf.doc_id,
    rf.email,
    {source_id},
    {reliability_rank},
    {snapshot_id}
FROM tmp_resolved_facts rf
JOIN tmp_row_delta delta ON delta.source_row_number = rf.source_row_number
WHERE rf.email IS NOT NULL
  AND rf.doc_id IS NOT NULL;
