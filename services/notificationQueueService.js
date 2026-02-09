const pool = require("../db");

async function enqueueJob({
  event_key,
  target_type,
  target_value,
  payload,
  run_at = null,
}) {
  const { rows } = await pool.query(
    `
    INSERT INTO notification_jobs
      (event_key, target_type, target_value, payload, run_at)
    VALUES
      ($1, $2, $3::jsonb, $4::jsonb, $5)
    RETURNING *
    `,
    [
      event_key,
      target_type,
      JSON.stringify(target_value || {}),
      JSON.stringify(payload || {}),
      run_at, // timestamp or null
    ],
  );

  return rows[0];
}

module.exports = { enqueueJob };
