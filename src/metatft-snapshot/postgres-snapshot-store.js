export class PostgresSnapshotStore {
  constructor(pool) {
    this.pool = pool;
  }

  async initialize() {}

  async createBatch(value) {
    await this.pool.query(`INSERT INTO metatft_snapshot_batch(snapshot_batch_id,captured_at,captured_date,status)
      VALUES($1,$2,$3,$4)`, [value.snapshotBatchId, value.capturedAt, value.capturedDate, value.status]);
  }

  async previousCount({ environment, cohort, capturedDate }) {
    const { rows } = await this.pool.query(`SELECT captured_date,COUNT(*)::integer AS count
      FROM metatft_comp_snapshot
      WHERE environment=$1 AND cohort=$2 AND captured_date < $3
      GROUP BY captured_date ORDER BY captured_date DESC LIMIT 1`, [environment, cohort, capturedDate]);
    return rows[0] ? Number(rows[0].count) : 0;
  }

  async insertRows(records) {
    const client = await this.pool.connect();
    let inserted = 0;
    try {
      await client.query("BEGIN");
      for (const row of records) {
        const result = await client.query(`INSERT INTO metatft_comp_snapshot(
          snapshot_batch_id,captured_at,captured_date,environment,patch,tft_set,region,cohort,rank_filter,
          rank_bucket_schema_version,window_days,comp_key,comp_key_version,source_cluster_id,comp_name,games,
          avg_placement,top4_rate,win_rate,pick_rate,selection_rate,source,source_updated_at,raw_payload_hash,
          data_origin,units_json,traits_json)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
          ON CONFLICT DO NOTHING`, [
          row.snapshotBatchId, row.capturedAt, row.capturedDate, row.environment, row.patch, row.tftSet,
          row.region, row.cohort, row.rankFilter, row.rankBucketSchemaVersion, row.windowDays, row.compKey,
          row.compKeyVersion, row.sourceClusterId, row.compName, row.games, row.avgPlacement, row.top4Rate,
          row.winRate, row.pickRate, row.selectionRate, row.source, row.sourceUpdatedAt, row.rawPayloadHash,
          row.dataOrigin, JSON.stringify(row.units), JSON.stringify(row.traits)
        ]);
        inserted += result.rowCount;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { inserted, duplicates: records.length - inserted };
  }

  async finishBatch({ snapshotBatchId, status, report }) {
    await this.pool.query(`UPDATE metatft_snapshot_batch
      SET status=$1,report_json=$2::jsonb,finished_at=now() WHERE snapshot_batch_id=$3`,
    [status, JSON.stringify(report), snapshotBatchId]);
  }
}
