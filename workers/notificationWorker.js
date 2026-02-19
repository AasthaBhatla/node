// worker/notificationWorker.js
require("dotenv").config();
const pool = require("../db");
const { sendToTokens, sendToTopic } = require("../services/fcm");
const {
  getUserDeviceTokens,
  getTokensByUserIds,
} = require("../services/userService");
const { storeNotification } = require("../services/notificationStoreService");
const emailService = require("../services/emailService");

// ✅ NEW
const notifPrefs = require("../services/notificationPrefsService");

const BATCH_SIZE = parseInt(process.env.NOTIF_WORKER_BATCH || "10", 10);
const MAX_ATTEMPTS = parseInt(process.env.NOTIF_MAX_ATTEMPTS || "5", 10);
const POLL_MS = parseInt(process.env.NOTIF_WORKER_POLL_MS || "1500", 10);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getEmailsByUserIds(userIds = []) {
  const ids = (Array.isArray(userIds) ? userIds : [])
    .map((x) => parseInt(x, 10))
    .filter(Number.isFinite);

  if (!ids.length) return [];

  const { rows } = await pool.query(
    `SELECT id, email FROM users WHERE id = ANY($1::int[]) AND email IS NOT NULL`,
    [ids],
  );

  return rows
    .map((r) => ({
      user_id: r.id,
      email: String(r.email || "")
        .trim()
        .toLowerCase(),
    }))
    .filter((r) => r.email);
}

async function lockJobs(client) {
  const { rows } = await client.query(
    `
    SELECT id, event_key, target_type, target_value, payload, attempts
    FROM notification_jobs
    WHERE status = 'queued'
      AND (run_at IS NULL OR run_at <= NOW())
      AND attempts < $1
    ORDER BY COALESCE(run_at, created_at) ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
    `,
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
    const parsed = ids.map((x) => parseInt(x, 10)).filter(Number.isFinite);
    if (!parsed.length) return [];

    const { rows } = await pool.query(
      `SELECT id FROM users WHERE id = ANY($1::int[])`,
      [parsed],
    );

    return rows.map((r) => r.id);
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
  const email = p.email === true;

  // ✅ NEW: bypass prefs for critical notifications
  const force = p.force === true;

  if (!title || !body) throw new Error("Invalid payload: title/body required");

  // Resolve targets → userIds
  let userIds = await getUserIdsForTarget(job.target_type, job.target_value);
  userIds = (Array.isArray(userIds) ? userIds : [])
    .map((x) => parseInt(x, 10))
    .filter(Number.isFinite);

  if (!userIds.length) {
    return {
      ok: true,
      users_total: 0,
      users_allowed: 0,
      users_skipped: 0,
      stored_ok: 0,
      stored_fail: 0,
      pushed_ok: 0,
      pushed_fail: 0,
      emailed_ok: 0,
      emailed_fail: 0,
    };
  }

  // ✅ NEW: apply user notification prefs using event_key hierarchy
  const users_total = userIds.length;
  let users_skipped = 0;

  if (!force) {
    try {
      const prefsMap = await notifPrefs.getPrefsMapByUserIds(userIds);

      const allowed = [];
      for (const uid of userIds) {
        const prefs = prefsMap.get(uid); // missing => allowed
        if (!prefs) {
          allowed.push(uid);
          continue;
        }
        if (prefs.pause_all === true) {
          users_skipped++;
          continue;
        }
        if (notifPrefs.isEventMuted(job.event_key, prefs.muted_scopes)) {
          users_skipped++;
          continue;
        }
        allowed.push(uid);
      }

      userIds = allowed;
    } catch (err) {
      // FAIL-OPEN: if prefs lookup fails, deliver as usual
      console.error("⚠️ notif prefs check failed (fail-open):", {
        job_id: job.id,
        event_key: job.event_key,
        message: err?.message || String(err),
      });
    }
  }

  const users_allowed = userIds.length;

  // If everyone is muted, we consider job "successfully processed"
  if (!userIds.length) {
    return {
      ok: true,
      users_total,
      users_allowed: 0,
      users_skipped,
      stored_ok: 0,
      stored_fail: 0,
      pushed_ok: 0,
      pushed_fail: 0,
      emailed_ok: 0,
      emailed_fail: 0,
      muted: true,
    };
  }

  // --- 1) STORE ---
  let stored_ok = 0;
  let stored_fail = 0;
  const store_errors = [];

  if (store) {
    for (const uid of userIds) {
      try {
        await storeNotification(uid, {
          title,
          body,
          data,
          channel,
          job_id: job.id,
        });
        stored_ok++;
      } catch (err) {
        stored_fail++;
        if (store_errors.length < 10) {
          store_errors.push({
            user_id: uid,
            message: err?.message || String(err),
            code: err?.code,
          });
        }
        console.error("❌ storeNotification failed:", {
          job_id: job.id,
          user_id: uid,
          message: err?.message,
          code: err?.code,
        });
      }
    }
  }

  // --- 2) PUSH ---
  let pushed_ok = 0;
  let pushed_fail = 0;
  const push_errors = [];

  if (push) {
    try {
      // ✅ Only fetch tokens for allowed users
      const tokens = await getTokensByUserIds(userIds);

      if (Array.isArray(tokens) && tokens.length) {
        for (let i = 0; i < tokens.length; i += 500) {
          const chunk = tokens.slice(i, i + 500);
          try {
            await sendToTokens(chunk, {
              notification: { title, body },
              data,
            });
            pushed_ok += chunk.length;
          } catch (err) {
            pushed_fail += chunk.length;
            if (push_errors.length < 10) {
              push_errors.push({
                chunk_index: Math.floor(i / 500),
                chunk_size: chunk.length,
                message: err?.message || String(err),
                code: err?.code,
              });
            }
            console.error("❌ sendToTokens chunk failed:", {
              job_id: job.id,
              chunk_index: Math.floor(i / 500),
              chunk_size: chunk.length,
              message: err?.message,
              code: err?.code,
            });
          }
        }
      }
    } catch (err) {
      pushed_fail = -1;
      if (push_errors.length < 10) {
        push_errors.push({
          message: err?.message || String(err),
          code: err?.code,
        });
      }
      console.error("❌ push pipeline failed:", {
        job_id: job.id,
        message: err?.message,
        code: err?.code,
      });
    }
  }

  // --- 3) EMAIL ---
  let emailed_ok = 0;
  let emailed_fail = 0;
  const email_errors = [];

  if (email) {
    try {
      // ✅ Only fetch emails for allowed users
      const targets = await getEmailsByUserIds(userIds);

      for (const t of targets) {
        try {
          await emailService.sendEmail({
            to: t.email,
            subject: title,
            text: body,
            html: `
            <div style="font-family:Arial,sans-serif;line-height:1.5">
              <h3 style="margin:0 0 12px">${title}</h3>
              <p style="margin:0 0 12px">${body}</p>
            </div>
          `,
          });
          emailed_ok++;
        } catch (err) {
          emailed_fail++;
          if (email_errors.length < 10) {
            email_errors.push({
              user_id: t.user_id,
              email: t.email,
              message: err?.message || String(err),
              code: err?.code,
            });
          }
          console.error("❌ email send failed:", {
            job_id: job.id,
            user_id: t.user_id,
            email: t.email,
            message: err?.message,
            code: err?.code,
          });
        }
      }
    } catch (err) {
      emailed_fail = -1;
      if (email_errors.length < 10) {
        email_errors.push({
          message: err?.message || String(err),
          code: err?.code,
        });
      }
      console.error("❌ email pipeline failed:", {
        job_id: job.id,
        message: err?.message,
        code: err?.code,
      });
    }
  }

  // Success logic (same philosophy as your current code)
  const anyStoreSuccess = store ? stored_ok > 0 : false;
  const anyPushSuccess = push ? pushed_ok > 0 : false;
  const anyEmailSuccess = email ? emailed_ok > 0 : false;

  const anySuccess =
    (store && anyStoreSuccess) ||
    (push && anyPushSuccess) ||
    (email && anyEmailSuccess);

  if (!anySuccess) {
    const reasonParts = [];
    if (store) reasonParts.push(`store_ok=0 store_fail=${stored_fail}`);
    if (push) reasonParts.push(`push_ok=${pushed_ok} push_fail=${pushed_fail}`);
    if (email)
      reasonParts.push(`email_ok=${emailed_ok} email_fail=${emailed_fail}`);
    const reason = reasonParts.join(" | ") || "no_success";

    const err = new Error(
      `Notification job produced no successful deliveries: ${reason}`,
    );
    err.details = {
      users_total,
      users_allowed,
      users_skipped,
      stored_ok,
      stored_fail,
      pushed_ok,
      pushed_fail,
      emailed_ok,
      emailed_fail,
      store_errors,
      push_errors,
      email_errors,
    };
    throw err;
  }

  return {
    ok: true,
    users_total,
    users_allowed,
    users_skipped,
    stored_ok,
    stored_fail,
    pushed_ok,
    pushed_fail,
    emailed_ok,
    emailed_fail,
    ...(store_errors.length ? { store_errors } : {}),
    ...(push_errors.length ? { push_errors } : {}),
    ...(email_errors.length ? { email_errors } : {}),
  };
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
