const pool = require("../db");

async function enqueueJob({ event_key, target_type, target_value, payload }) {
  const { rows } = await pool.query(
    `INSERT INTO notification_jobs (event_key, target_type, target_value, payload)
     VALUES ($1, $2, $3::jsonb, $4::jsonb)
     RETURNING *`,
    [
      event_key,
      target_type,
      JSON.stringify(target_value || {}),
      JSON.stringify(payload || {}),
    ],
  );
  return rows[0];
}

module.exports = { enqueueJob };
