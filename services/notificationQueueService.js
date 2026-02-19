// services/notificationQueueService.js
const pool = require("../db");

// ✅ NEW: enqueue-time preference gating (for immediate jobs only)
const notifPrefs = require("./notificationPrefsService");

function toIntArray(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((x) => parseInt(x, 10))
    .filter(Number.isFinite);
}

function uniqueInts(arr) {
  const set = new Set(arr);
  return Array.from(set);
}

async function enqueueJob({
  event_key,
  target_type,
  target_value,
  payload,
  run_at = null,
}) {
  // -----------------------------
  // ✅ ENQUEUE-TIME PREF FILTERING
  // Only for immediate jobs (run_at === null).
  // Scheduled jobs must still be inserted so user can unmute later and receive them.
  // Worker remains source-of-truth at delivery time.
  // -----------------------------
  try {
    const force = payload?.force === true;

    if (
      !force &&
      run_at === null &&
      (target_type === "user" || target_type === "users")
    ) {
      let ids = [];

      if (target_type === "user") {
        const uid = parseInt(target_value?.user_id, 10);
        if (Number.isFinite(uid)) ids = [uid];
      } else {
        ids = toIntArray(target_value?.user_ids);
      }

      ids = uniqueInts(ids);

      if (ids.length) {
        const prefsMap = await notifPrefs.getPrefsMapByUserIds(ids);

        const allowedIds = ids.filter((uid) => {
          const prefs = prefsMap.get(uid); // missing => allowed
          if (!prefs) return true;
          if (prefs.pause_all === true) return false;
          if (notifPrefs.isEventMuted(event_key, prefs.muted_scopes))
            return false;
          return true;
        });

        if (target_type === "user") {
          if (!allowedIds.length) {
            // ✅ skip creating job
            return {
              id: null,
              status: "skipped",
              skipped: true,
              skip_reason: "muted_by_user_prefs",
              event_key,
              target_type,
              target_value: target_value || {},
              payload: payload || {},
              run_at: null,
            };
          }
        } else {
          // users target: shrink the user_ids list
          if (!allowedIds.length) {
            return {
              id: null,
              status: "skipped",
              skipped: true,
              skip_reason: "all_targets_muted_by_user_prefs",
              event_key,
              target_type,
              target_value: target_value || {},
              payload: payload || {},
              run_at: null,
            };
          }

          target_value = { ...(target_value || {}), user_ids: allowedIds };
        }
      }
    }
  } catch (err) {
    // ✅ FAIL-OPEN: if prefs lookup fails, we still enqueue.
    // Worker will still enforce prefs later.
    console.error("⚠️ enqueue prefs check failed (fail-open):", {
      event_key,
      target_type,
      message: err?.message || String(err),
    });
  }

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

async function cancelScheduledJobs({
  // mandatory guardrails
  status = "queued",
  requireRunAt = true,

  // optional filters
  event_key_like, // e.g. "appointments.reminder.%"
  event_key_in, // e.g. ["appointments.reminder.tminus10", "appointments.reminder.at"]
  target_type, // "user"
  target_user_id, // 123

  // payload.data filters (JSONB)
  data_equals = {}, // e.g. { appointment_id: "55" }
  data_in = {}, // e.g. { reminder_kind: ["tminus10","at"] }

  // bookkeeping
  reason = "cancelled_by_system",
} = {}) {
  const where = [];
  const params = [];
  let i = 0;

  i += 1;
  params.push(status);
  where.push(`status = $${i}`);

  if (requireRunAt) where.push(`run_at IS NOT NULL`);

  if (target_type) {
    i += 1;
    params.push(target_type);
    where.push(`target_type = $${i}`);
  }

  if (Number.isFinite(Number(target_user_id))) {
    i += 1;
    params.push(Number(target_user_id));
    where.push(`(target_value->>'user_id')::int = $${i}`);
  }

  if (event_key_like) {
    i += 1;
    params.push(String(event_key_like));
    where.push(`event_key LIKE $${i}`);
  }

  if (Array.isArray(event_key_in) && event_key_in.length) {
    i += 1;
    params.push(event_key_in.map(String));
    where.push(`event_key = ANY($${i}::text[])`);
  }

  for (const [k, v] of Object.entries(data_equals || {})) {
    i += 1;
    params.push(String(v));
    where.push(`(payload->'data'->>'${k}') = $${i}`);
  }

  for (const [k, arr] of Object.entries(data_in || {})) {
    if (!Array.isArray(arr) || !arr.length) continue;
    i += 1;
    params.push(arr.map(String));
    where.push(`(payload->'data'->>'${k}') = ANY($${i}::text[])`);
  }

  const sql = `
    UPDATE notification_jobs
    SET status = 'cancelled',
        processed_at = NOW(),
        last_error = COALESCE(last_error, $${i + 1})
    WHERE ${where.join(" AND ")}
    RETURNING id
  `;
  params.push(String(reason));
  const { rows } = await pool.query(sql, params);

  return { cancelled: rows.length, job_ids: rows.map((r) => r.id) };
}

module.exports = { enqueueJob, cancelScheduledJobs };
