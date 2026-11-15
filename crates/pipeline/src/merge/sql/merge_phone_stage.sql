-- Build mode: append resolved phones to the unindexed staging table. One
-- GROUP BY pass after the last source materializes document_phone and
-- company_phone; see merge::finalize_build_merge_tables.
INSERT INTO build_stage_phone(doc_id, company_id, phone, snapshot_id, confidence)
SELECT
    rf.doc_id,
    rf.company_id,
    je.value AS phone,
    {snapshot_id},
    {reliability_rank}
FROM tmp_stage ts
JOIN tmp_resolved_facts rf ON rf.source_row_number = ts.source_row_number,
    json_each(ts.phones_json) je
WHERE ts.had_phone_input = 1
  AND ts.phones_json <> '[]'
  AND (rf.doc_id IS NOT NULL OR rf.company_id IS NOT NULL);
