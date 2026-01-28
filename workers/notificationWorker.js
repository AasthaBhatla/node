require("dotenv").config();
const pool = require("../db");
const { sendToTokens, sendToTopic } = require("../services/fcm");
const {
  getUserDeviceTokens,
  getTokensByUserIds,
} = require("../services/userService");
const { storeNotification } = require("../services/notificationStoreService");

const BATCH_SIZE = parseInt(process.env.NOTIF_WORKER_BATCH || "10", 10);
const MAX_ATTEMPTS = parseInt(process.env.NOTIF_MAX_ATTEMPTS || "5", 10);
const POLL_MS = parseInt(process.env.NOTIF_WORKER_POLL_MS || "1500", 10);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function lockJobs(client) {
  const { rows } = await client.query(
    `SELECT id, event_key, target_type, target_value, payload, attempts
     FROM notification_jobs
     WHERE status = 'queued' AND attempts < $1
     ORDER BY created_at ASC
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [MAX_ATTEMPTS, BATCH_SIZE],
  );
  return rows;
}

async function setStatus(id, status, extra = {}) {
  const { last_error = null, attemptsInc = 0, processed = false } = extra;
  await pool.query(
    `UPDATE notification_jobs
     SET status = $2,
         attempts = attempts + $3,
         last_error = COALESCE($4, last_error),
         processed_at = CASE WHEN $5 THEN NOW() ELSE processed_at END
     WHERE id = $1`,
    [
      id,
      status,
      attemptsInc,
      last_error ? String(last_error).slice(0, 1000) : null,
      processed,
    ],
  );
}

async function getUserIdsForTarget(target_type, target_value) {
  if (target_type === "user") {
    const id = parseInt(target_value?.user_id, 10);
    return Number.isFinite(id) ? [id] : [];
  }

  if (target_type === "users") {
    const ids = Array.isArray(target_value?.user_ids)
      ? target_value.user_ids
      : [];
    return ids.map((x) => parseInt(x, 10)).filter(Number.isFinite);
  }

  if (target_type === "role") {
    const role = String(target_value?.role || "")
      .toLowerCase()
      .trim();
    if (!role) return [];
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE LOWER(role) = $1 AND LOWER(role) <> 'admin'`,
      [role],
    );
    return rows.map((r) => r.id);
  }

  if (target_type === "all") {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE LOWER(COALESCE(role,'')) <> 'admin'`,
    );
    return rows.map((r) => r.id);
  }

  return [];
}

async function processJob(job) {
  const p = job.payload || {};
  const title = String(p.title || "").trim();
  const body = String(p.body || "").trim();
  const data = p.data && typeof p.data === "object" ? p.data : {};
  const push = p.push !== false;
  const store = p.store !== false;
  const channel = p.channel || "push";

  if (!title || !body) throw new Error("Invalid payload: title/body required");

  // Resolve targets → userIds
  const userIds = await getUserIdsForTarget(job.target_type, job.target_value);

  // 1) Store to inbox
  if (store && userIds.length) {
    // store one-by-one (simple, safe). Can be optimized later via bulk insert.
    for (const uid of userIds) {
      await storeNotification(uid, {
        title,
        body,
        data,
        channel,
        job_id: job.id,
      });
    }
  }

  // 2) Push delivery
  if (push) {
    // For "all" you can use an FCM topic instead IF you manage topic subscriptions.
    // For now we do token-based delivery.
    if (userIds.length) {
      const tokens = await getTokensByUserIds(userIds);
      if (tokens.length) {
        // chunk 500
        for (let i = 0; i < tokens.length; i += 500) {
          await sendToTokens(tokens.slice(i, i + 500), {
            notification: { title, body },
            data,
          });
        }
      }
    }
  }

  return { ok: true, users: userIds.length };
}

async function main() {
  console.log("🔔 notification worker started");

  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const jobs = await lockJobs(client);
      const ids = jobs.map((j) => j.id);

      if (ids.length) {
        await client.query(
          `UPDATE notification_jobs SET status = 'processing'
           WHERE id = ANY($1::int[])`,
          [ids],
        );
      }

      await client.query("COMMIT");
      client.release();

      for (const job of jobs) {
        try {
          await processJob(job);
          await setStatus(job.id, "sent", { processed: true });
        } catch (err) {
          console.error("❌ Job failed:", {
            job_id: job.id,
            event_key: job.event_key,
            target_type: job.target_type,
            target_value: job.target_value,
            attempts: job.attempts,
            error_message: err?.message,
            error_code: err?.code,
            error_stack: err?.stack,
            error_raw: err,
          });
          const msg =
            (err?.code ? `${err.code}: ` : "") + (err?.message || String(err));
          const nextAttempts = (job.attempts || 0) + 1;
          if (nextAttempts >= MAX_ATTEMPTS) {
            await setStatus(job.id, "failed", {
              attemptsInc: 1,
              last_error: msg,
              processed: true,
            });
          } else {
            await setStatus(job.id, "queued", {
              attemptsInc: 1,
              last_error: msg,
            });
          }
        }
      }
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      client.release();
      console.error("Worker loop error:", err);
    }

    await sleep(POLL_MS);
  }
}

main().catch((e) => {
  console.error("Worker fatal:", e);
  process.exit(1);
});
