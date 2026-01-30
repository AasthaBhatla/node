// services/jobService.js
const pool = require("../db");
const { getUserCardsByIds } = require("./userService");

// -------------------------
// Small helpers
// -------------------------
const parsePosInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const safeLimitOffset = ({ page = 1, limit = 20, max = 100 } = {}) => {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lRaw = Math.max(1, parseInt(limit, 10) || 20);
  const l = Math.min(lRaw, max);
  const offset = (p - 1) * l;
  return { page: p, limit: l, offset };
};

const assertPosInt = (v, msg = "must be a positive integer") => {
  if (!Number.isInteger(v) || v <= 0) {
    const e = new Error(msg);
    e.statusCode = 400;
    throw e;
  }
};

const assertEnum = (value, allowed, msg) => {
  if (!allowed.includes(String(value))) {
    const e = new Error(msg);
    e.statusCode = 400;
    throw e;
  }
};

async function getOptionInt(client, key, fallback) {
  // Your project already has optionsRoutes.
  // This assumes an `options` table with (key TEXT UNIQUE, value TEXT).
  try {
    const r = await client.query(
      `SELECT value FROM options WHERE key = $1 LIMIT 1`,
      [String(key)],
    );
    if (!r.rows[0]) return fallback;
    const n = parseInt(r.rows[0].value, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch (_) {
    return fallback;
  }
}

async function bumpPlatformWallet(client, deltaCredits) {
  if (!Number.isInteger(deltaCredits) || deltaCredits === 0) return;

  await client.query(
    `INSERT INTO platform_wallet (id, balance_credits)
     VALUES (1, 0)
     ON CONFLICT (id) DO NOTHING`,
  );

  const r = await client.query(
    `UPDATE platform_wallet
     SET balance_credits = balance_credits + $1,
         updated_at = NOW()
     WHERE id = 1
     RETURNING balance_credits`,
    [deltaCredits],
  );

  const bal = parseInt(r.rows[0]?.balance_credits ?? 0, 10);
  if (bal < 0) {
    const e = new Error("Platform wallet would go negative");
    e.statusCode = 500;
    throw e;
  }
}

// -------------------------
// Wallet (TX-local) helpers
// -------------------------
async function ensureWalletRow(client, userId) {
  const u = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!u.rows[0]) {
    const e = new Error("User not found");
    e.statusCode = 404;
    throw e;
  }
  await client.query(
    `INSERT INTO wallet (user_id, balance_credits)
     VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

async function walletDebitTx(
  client,
  {
    userId,
    amount,
    reason,
    reference_kind,
    reference_id,
    idempotency_key,
    metadata,
  },
) {
  assertPosInt(amount, "amount must be a positive integer");

  await ensureWalletRow(client, userId);

  const w = await client.query(
    `SELECT balance_credits
     FROM wallet
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  );
  const bal = parseInt(w.rows[0]?.balance_credits ?? 0, 10);

  if (bal < amount) {
    const e = new Error("Insufficient wallet balance");
    e.statusCode = 400;
    throw e;
  }

  let inserted = false;
  if (idempotency_key) {
    const ins = await client.query(
      `INSERT INTO wallet_transactions
        (user_id, direction, amount_credits, reason, reference_kind, reference_id, idempotency_key, metadata)
       VALUES
        ($1, 'debit', $2, $3, $4, $5, $6, COALESCE($7, '{}'::jsonb))
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        userId,
        amount,
        reason,
        reference_kind || null,
        reference_id || null,
        String(idempotency_key),
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    inserted = ins.rowCount === 1;
  } else {
    const ins = await client.query(
      `INSERT INTO wallet_transactions
        (user_id, direction, amount_credits, reason, reference_kind, reference_id, metadata)
       VALUES
        ($1, 'debit', $2, $3, $4, $5, COALESCE($6, '{}'::jsonb))
       RETURNING id`,
      [
        userId,
        amount,
        reason,
        reference_kind || null,
        reference_id || null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    inserted = ins.rowCount === 1;
  }

  if (!inserted) return { inserted: false };

  await client.query(
    `UPDATE wallet
     SET balance_credits = balance_credits - $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [amount, userId],
  );

  return { inserted: true };
}

async function walletCreditTx(
  client,
  {
    userId,
    amount,
    reason,
    reference_kind,
    reference_id,
    idempotency_key,
    metadata,
  },
) {
  assertPosInt(amount, "amount must be a positive integer");

  await ensureWalletRow(client, userId);

  await client.query(
    `SELECT balance_credits
     FROM wallet
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  );

  let inserted = false;
  if (idempotency_key) {
    const ins = await client.query(
      `INSERT INTO wallet_transactions
        (user_id, direction, amount_credits, reason, reference_kind, reference_id, idempotency_key, metadata)
       VALUES
        ($1, 'credit', $2, $3, $4, $5, $6, COALESCE($7, '{}'::jsonb))
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        userId,
        amount,
        reason,
        reference_kind || null,
        reference_id || null,
        String(idempotency_key),
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    inserted = ins.rowCount === 1;
  } else {
    const ins = await client.query(
      `INSERT INTO wallet_transactions
        (user_id, direction, amount_credits, reason, reference_kind, reference_id, metadata)
       VALUES
        ($1, 'credit', $2, $3, $4, $5, COALESCE($6, '{}'::jsonb))
       RETURNING id`,
      [
        userId,
        amount,
        reason,
        reference_kind || null,
        reference_id || null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    inserted = ins.rowCount === 1;
  }

  if (!inserted) return { inserted: false };

  await client.query(
    `UPDATE wallet
     SET balance_credits = balance_credits + $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [amount, userId],
  );

  return { inserted: true };
}

// -------------------------
// JOB: Create
// -------------------------
async function createJob({
  clientId,
  title,
  case_description,
  case_type = null,
  location_id = null,
  urgency,
  budget_credits = 0,
  attachments = [],
  posting_fee_idempotency_key = null,
}) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const urg = String(urgency || "")
    .toLowerCase()
    .trim();
  assertEnum(
    urg,
    ["low", "medium", "high", "critical"],
    "Invalid urgency. Allowed: low, medium, high, critical",
  );

  const budget = parseInt(budget_credits, 10) || 0;
  if (budget < 0) {
    const e = new Error("budget_credits must be >= 0");
    e.statusCode = 400;
    throw e;
  }

  const att = Array.isArray(attachments)
    ? attachments.map((u) => String(u || "").trim()).filter(Boolean)
    : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const jobRes = await client.query(
      `INSERT INTO jobs
        (client_id, title, case_description, case_type, location_id, urgency, budget_credits, status)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'open')
       RETURNING *`,
      [
        clientId,
        String(title || "").trim(),
        String(case_description || "").trim(),
        case_type ? String(case_type).trim() : null,
        location_id ? parseInt(location_id, 10) : null,
        urg,
        budget,
      ],
    );

    const job = jobRes.rows[0];

    for (const url of att) {
      await client.query(
        `INSERT INTO job_attachments (job_id, url) VALUES ($1, $2)`,
        [job.id, url],
      );
    }

    const defaultFee = 500;
    const postFee = await getOptionInt(
      client,
      "job_post_fee_credits",
      defaultFee,
    );
    const freeCount = await getOptionInt(client, "free_job_posts_count", 0);

    const countRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM jobs WHERE client_id = $1`,
      [clientId],
    );
    const alreadyPosted = parseInt(countRes.rows[0]?.c ?? 0, 10);

    const feeToCharge = alreadyPosted <= freeCount ? 0 : postFee;

    if (feeToCharge > 0) {
      const idem = posting_fee_idempotency_key
        ? String(posting_fee_idempotency_key)
        : `job_post_fee:${job.id}:${clientId}`;

      const debit = await walletDebitTx(client, {
        userId: clientId,
        amount: feeToCharge,
        reason: "job_post_fee",
        reference_kind: "job",
        reference_id: String(job.id),
        idempotency_key: idem,
        metadata: { kind: "job_post_fee", job_id: job.id },
      });

      await client.query(
        `INSERT INTO job_posting_fees
          (job_id, client_id, amount_credits, idempotency_key)
         VALUES
          ($1, $2, $3, $4)
         ON CONFLICT (job_id) DO NOTHING`,
        [job.id, clientId, feeToCharge, idem],
      );

      if (debit.inserted) {
        await bumpPlatformWallet(client, feeToCharge);
      }
    }

    await client.query("COMMIT");

    return {
      job,
      attachments: att,
      posting_fee_charged_credits: feeToCharge,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
}

// -------------------------
// JOB: List for client
// -------------------------
async function listClientJobs({
  clientId,
  page = 1,
  limit = 20,
  includeApplicants = false,
}) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const {
    page: p,
    limit: l,
    offset,
  } = safeLimitOffset({ page, limit, max: 100 });

  const jobsRes = await pool.query(
    `
    SELECT
      j.*,
      (
        SELECT COUNT(*)::int
        FROM job_applications a
        WHERE a.job_id = j.id
          AND a.status = 'applied'
      ) AS applicant_count
    FROM jobs j
    WHERE j.client_id = $1
    ORDER BY j.created_at DESC
    LIMIT $2 OFFSET $3
  `,
    [clientId, l, offset],
  );

  const jobs = jobsRes.rows || [];
  if (!includeApplicants || jobs.length === 0) {
    return { page: p, limit: l, jobs };
  }

  const jobIds = jobs.map((j) => j.id);

  const appsRes = await pool.query(
    `
    SELECT
      a.job_id,
      a.partner_id,
      a.quote_credits,
      a.message,
      a.status,
      a.created_at,
      a.updated_at
    FROM job_applications a
    WHERE a.job_id = ANY($1::bigint[])
      AND a.status = 'applied'
    ORDER BY a.created_at DESC
  `,
    [jobIds],
  );

  const apps = appsRes.rows || [];
  const partnerIds = [...new Set(apps.map((a) => a.partner_id))];
  const partnerCards = await getUserCardsByIds(partnerIds);
  const partnerMap = new Map(partnerCards.map((u) => [u.id, u]));

  const appsByJob = new Map();
  for (const a of apps) {
    if (!appsByJob.has(a.job_id)) appsByJob.set(a.job_id, []);
    appsByJob.get(a.job_id).push({
      partner: partnerMap.get(a.partner_id) || {
        id: a.partner_id,
        metadata: {},
      },
      quote_credits: parseInt(a.quote_credits, 10),
      message: a.message,
      status: a.status,
      created_at: a.created_at,
      updated_at: a.updated_at,
    });
  }

  const finalJobs = jobs.map((j) => ({
    ...j,
    applications: appsByJob.get(j.id) || [],
  }));

  return { page: p, limit: l, jobs: finalJobs };
}

// -------------------------
// JOB: Detail (client view)
// -------------------------
async function getJobDetailForClient({ clientId, jobId }) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(jobId);
  if (!jid) {
    const e = new Error("Invalid job_id");
    e.statusCode = 400;
    throw e;
  }

  const jobRes = await pool.query(`SELECT * FROM jobs WHERE id = $1 LIMIT 1`, [
    jid,
  ]);
  const job = jobRes.rows[0];
  if (!job || job.client_id !== clientId) {
    const e = new Error("Job not found");
    e.statusCode = 404;
    throw e;
  }

  const attRes = await pool.query(
    `SELECT id, url, created_at FROM job_attachments WHERE job_id = $1 ORDER BY created_at ASC`,
    [jid],
  );

  const appsRes = await pool.query(
    `
    SELECT
      partner_id,
      quote_credits,
      message,
      status,
      created_at,
      updated_at
    FROM job_applications
    WHERE job_id = $1
    ORDER BY created_at DESC
  `,
    [jid],
  );

  const apps = appsRes.rows || [];
  const partnerIds = [...new Set(apps.map((a) => a.partner_id))];
  const partnerCards = await getUserCardsByIds(partnerIds);
  const partnerMap = new Map(partnerCards.map((u) => [u.id, u]));

  return {
    job,
    attachments: attRes.rows || [],
    applications: apps.map((a) => ({
      partner: partnerMap.get(a.partner_id) || {
        id: a.partner_id,
        metadata: {},
      },
      quote_credits: parseInt(a.quote_credits, 10),
      message: a.message,
      status: a.status,
      created_at: a.created_at,
      updated_at: a.updated_at,
    })),
  };
}

// -------------------------
// NEW: Partner - list open jobs (pagination)
// - shows applicant_count
// - does NOT include applicant list (keeps it light)
// - hides "my application" here; that is in detail endpoint
// -------------------------
async function listOpenJobs({ partnerId, page = 1, limit = 20 }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const {
    page: p,
    limit: l,
    offset,
  } = safeLimitOffset({ page, limit, max: 100 });

  const r = await pool.query(
    `
    SELECT
      j.*,
      (
        SELECT COUNT(*)::int
        FROM job_applications a
        WHERE a.job_id = j.id
          AND a.status = 'applied'
      ) AS applicant_count
    FROM jobs j
    WHERE j.status = 'open'
      AND j.assigned_partner_id IS NULL
    ORDER BY j.created_at DESC
    LIMIT $1 OFFSET $2
  `,
    [l, offset],
  );

  return { page: p, limit: l, jobs: r.rows || [] };
}

// -------------------------
// NEW: Partner - job detail
// - allows partner to view open jobs + assigned-to-me jobs
// - includes attachments
// - includes my_application (if exists)
// - includes applicant_count (useful to show competition)
// NOTE: We deliberately do NOT expose all applicants to a partner.
// -------------------------
async function getJobDetailForPartner({ partnerId, jobId }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const jid = parsePosInt(jobId);
  if (!jid) {
    const e = new Error("Invalid job_id");
    e.statusCode = 400;
    throw e;
  }

  const jobRes = await pool.query(
    `
    SELECT
      j.*,
      (
        SELECT COUNT(*)::int
        FROM job_applications a
        WHERE a.job_id = j.id
          AND a.status = 'applied'
      ) AS applicant_count
    FROM jobs j
    WHERE j.id = $1
    LIMIT 1
  `,
    [jid],
  );

  const job = jobRes.rows[0];
  if (!job) {
    const e = new Error("Job not found");
    e.statusCode = 404;
    throw e;
  }

  // Visibility rules for partner:
  // - If OPEN and unassigned => ok
  // - If assigned => only assigned partner can view (running job)
  const isOpenPublic = job.status === "open" && !job.assigned_partner_id;
  const isMineAssigned = job.assigned_partner_id === partnerId;

  if (!isOpenPublic && !isMineAssigned) {
    const e = new Error("Job not found");
    e.statusCode = 404;
    throw e;
  }

  const attRes = await pool.query(
    `SELECT id, url, created_at FROM job_attachments WHERE job_id = $1 ORDER BY created_at ASC`,
    [jid],
  );

  const myAppRes = await pool.query(
    `
    SELECT
      quote_credits,
      message,
      status,
      created_at,
      updated_at,
      withdrawn_at
    FROM job_applications
    WHERE job_id = $1 AND partner_id = $2
    LIMIT 1
  `,
    [jid, partnerId],
  );

  const my = myAppRes.rows[0] || null;

  return {
    job,
    attachments: attRes.rows || [],
    my_application: my
      ? {
          quote_credits: parseInt(my.quote_credits, 10),
          message: my.message,
          status: my.status,
          created_at: my.created_at,
          updated_at: my.updated_at,
          withdrawn_at: my.withdrawn_at,
        }
      : null,
  };
}

// -------------------------
// APPLICATION: Apply / Update
// -------------------------
async function upsertJobApplication({
  partnerId,
  jobId,
  quote_credits,
  message = null,
}) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(jobId);
  if (!jid) {
    const e = new Error("Invalid job_id");
    e.statusCode = 400;
    throw e;
  }
  const quote = parseInt(quote_credits, 10);
  assertPosInt(quote, "quote_credits must be a positive integer");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const jRes = await client.query(
      `SELECT id, status, assigned_partner_id
       FROM jobs
       WHERE id = $1
       FOR UPDATE`,
      [jid],
    );
    const job = jRes.rows[0];
    if (!job) {
      const e = new Error("Job not found");
      e.statusCode = 404;
      throw e;
    }
    if (job.status !== "open" || job.assigned_partner_id) {
      const e = new Error("Job is not open for applications");
      e.statusCode = 400;
      throw e;
    }

    await client.query(
      `
      INSERT INTO job_applications
        (job_id, partner_id, quote_credits, message, status, withdrawn_at)
      VALUES
        ($1, $2, $3, $4, 'applied', NULL)
      ON CONFLICT (job_id, partner_id)
      DO UPDATE SET
        quote_credits = EXCLUDED.quote_credits,
        message = EXCLUDED.message,
        status = 'applied',
        withdrawn_at = NULL,
        updated_at = NOW()
    `,
      [jid, partnerId, quote, message ? String(message) : null],
    );

    await client.query("COMMIT");
    return { message: "Application saved", job_id: jid, partner_id: partnerId };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
}

async function withdrawJobApplication({ partnerId, jobId }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(jobId);
  if (!jid) {
    const e = new Error("Invalid job_id");
    e.statusCode = 400;
    throw e;
  }

  const r = await pool.query(
    `
    UPDATE job_applications
    SET status = 'withdrawn',
        withdrawn_at = NOW(),
        updated_at = NOW()
    WHERE job_id = $1 AND partner_id = $2
      AND status = 'applied'
    RETURNING id
  `,
    [jid, partnerId],
  );

  if (r.rowCount === 0) {
    const e = new Error("No active application found to withdraw");
    e.statusCode = 400;
    throw e;
  }

  return {
    message: "Application withdrawn",
    job_id: jid,
    partner_id: partnerId,
  };
}

// -------------------------
// ASSIGN + ESCROW HOLD (client)
// -------------------------
async function assignJobAndHoldEscrow({
  clientId,
  jobId,
  partnerId,
  escrow_idempotency_key,
}) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(jobId);
  const pid = parsePosInt(partnerId);
  if (!jid || !pid) {
    const e = new Error("Invalid job_id or partner_id");
    e.statusCode = 400;
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const jRes = await client.query(
      `SELECT * FROM jobs WHERE id = $1 FOR UPDATE`,
      [jid],
    );
    const job = jRes.rows[0];
    if (!job || job.client_id !== clientId) {
      const e = new Error("Job not found");
      e.statusCode = 404;
      throw e;
    }

    if (job.status !== "open" || job.assigned_partner_id) {
      const e = new Error("Job is not assignable");
      e.statusCode = 400;
      throw e;
    }

    const aRes = await client.query(
      `
      SELECT quote_credits, status
      FROM job_applications
      WHERE job_id = $1 AND partner_id = $2
      LIMIT 1
    `,
      [jid, pid],
    );
    const app = aRes.rows[0];
    if (!app || app.status !== "applied") {
      const e = new Error("Partner has no active application for this job");
      e.statusCode = 400;
      throw e;
    }

    const quote = parseInt(app.quote_credits, 10);
    assertPosInt(quote, "quote_credits must be positive");

    const idem = escrow_idempotency_key
      ? String(escrow_idempotency_key)
      : `job_escrow_hold:${jid}:${clientId}:${pid}`;

    const debit = await walletDebitTx(client, {
      userId: clientId,
      amount: quote,
      reason: "job_escrow_hold",
      reference_kind: "job",
      reference_id: String(jid),
      idempotency_key: idem,
      metadata: { kind: "escrow_hold", job_id: jid, partner_id: pid },
    });

    const escRes = await client.query(
      `
      INSERT INTO job_escrow
        (job_id, client_id, partner_id, amount_credits, status, held_at)
      VALUES
        ($1, $2, $3, $4, 'held', NOW())
      ON CONFLICT (job_id) DO UPDATE
      SET partner_id = EXCLUDED.partner_id,
          amount_credits = EXCLUDED.amount_credits
      RETURNING id, status
    `,
      [jid, clientId, pid, quote],
    );
    const escrowId = escRes.rows[0].id;

    await client.query(
      `
      INSERT INTO escrow_transactions
        (escrow_id, kind, amount_credits, idempotency_key, metadata)
      VALUES
        ($1, 'hold', $2, $3, $4)
      ON CONFLICT (idempotency_key) DO NOTHING
    `,
      [
        escrowId,
        quote,
        idem,
        JSON.stringify({ job_id: jid, client_id: clientId, partner_id: pid }),
      ],
    );

    if (debit.inserted) {
      await bumpPlatformWallet(client, quote);
    }

    await client.query(
      `
      UPDATE jobs
      SET status = 'assigned',
          assigned_partner_id = $1,
          assigned_at = NOW(),
          updated_at = NOW()
      WHERE id = $2
    `,
      [pid, jid],
    );

    await client.query(
      `
      UPDATE job_applications
      SET status = CASE
        WHEN partner_id = $2 THEN 'accepted'
        WHEN status = 'applied' THEN 'rejected'
        ELSE status
      END,
      updated_at = NOW()
      WHERE job_id = $1
    `,
      [jid, pid],
    );

    await client.query("COMMIT");

    return {
      message: debit.inserted
        ? "Job assigned and escrow held"
        : "Job assignment already applied (idempotent)",
      job_id: jid,
      partner_id: pid,
      escrow_amount_credits: quote,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
}

// -------------------------
// Completion flow
// -------------------------
async function partnerMarkComplete({ partnerId, jobId }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(jobId);
  if (!jid) {
    const e = new Error("Invalid job_id");
    e.statusCode = 400;
    throw e;
  }

  const r = await pool.query(
    `
    UPDATE jobs
    SET status = 'completion_requested',
        partner_marked_complete_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
      AND assigned_partner_id = $2
      AND status IN ('assigned', 'in_progress', 'completion_requested')
    RETURNING id
  `,
    [jid, partnerId],
  );

  if (r.rowCount === 0) {
    const e = new Error("Job not found / not assigned to you / invalid status");
    e.statusCode = 400;
    throw e;
  }

  return { message: "Completion requested", job_id: jid };
}

async function clientApproveCompleteAndRelease({
  clientId,
  jobId,
  release_idempotency_key,
}) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(jobId);
  if (!jid) {
    const e = new Error("Invalid job_id");
    e.statusCode = 400;
    throw e;
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const jRes = await dbClient.query(
      `SELECT * FROM jobs WHERE id = $1 FOR UPDATE`,
      [jid],
    );
    const job = jRes.rows[0];
    if (!job || job.client_id !== clientId) {
      const e = new Error("Job not found");
      e.statusCode = 404;
      throw e;
    }

    if (!job.assigned_partner_id) {
      const e = new Error("Job is not assigned");
      e.statusCode = 400;
      throw e;
    }

    if (
      !["completion_requested", "assigned", "in_progress"].includes(job.status)
    ) {
      const e = new Error("Job is not in a completable state");
      e.statusCode = 400;
      throw e;
    }

    const eRes = await dbClient.query(
      `
      SELECT * FROM job_escrow
      WHERE job_id = $1
      FOR UPDATE
    `,
      [jid],
    );
    const escrow = eRes.rows[0];
    if (!escrow || escrow.status !== "held") {
      const e = new Error("No held escrow found for this job");
      e.statusCode = 400;
      throw e;
    }

    const amount = parseInt(escrow.amount_credits, 10);
    assertPosInt(amount, "Invalid escrow amount");

    const idem = release_idempotency_key
      ? String(release_idempotency_key)
      : `job_escrow_release:${jid}:${escrow.partner_id}`;

    const credit = await walletCreditTx(dbClient, {
      userId: escrow.partner_id,
      amount,
      reason: "job_payout",
      reference_kind: "job",
      reference_id: String(jid),
      idempotency_key: idem,
      metadata: { kind: "escrow_release", job_id: jid, client_id: clientId },
    });

    await dbClient.query(
      `
      INSERT INTO escrow_transactions
        (escrow_id, kind, amount_credits, idempotency_key, metadata)
      VALUES
        ($1, 'release', $2, $3, $4)
      ON CONFLICT (idempotency_key) DO NOTHING
    `,
      [
        escrow.id,
        amount,
        idem,
        JSON.stringify({ job_id: jid, partner_id: escrow.partner_id }),
      ],
    );

    if (credit.inserted) {
      await dbClient.query(
        `
        UPDATE job_escrow
        SET status = 'released',
            released_at = NOW()
        WHERE id = $1
      `,
        [escrow.id],
      );

      await bumpPlatformWallet(dbClient, -amount);
    }

    await dbClient.query(
      `
      UPDATE jobs
      SET status = 'completed',
          client_approved_complete_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
      [jid],
    );

    await dbClient.query("COMMIT");

    return {
      message: credit.inserted
        ? "Job completed and payout released"
        : "Payout already released (idempotent)",
      job_id: jid,
      partner_id: escrow.partner_id,
      amount_credits: amount,
    };
  } catch (err) {
    try {
      await dbClient.query("ROLLBACK");
    } catch (_) {}
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    dbClient.release();
  }
}

// -------------------------
// Partner dashboards
// -------------------------
async function getPartnerStats({ partnerId }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const appliedRes = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM job_applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.partner_id = $1
      AND a.status = 'applied'
      AND j.status = 'open'
  `,
    [partnerId],
  );

  const runningRes = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM jobs
    WHERE assigned_partner_id = $1
      AND status NOT IN ('completed', 'cancelled', 'refunded')
  `,
    [partnerId],
  );

  const completedRes = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM jobs
    WHERE assigned_partner_id = $1
      AND status = 'completed'
  `,
    [partnerId],
  );

  const earnRes = await pool.query(
    `
    SELECT
      COALESCE(SUM(amount_credits), 0)::int AS total_credits
    FROM wallet_transactions
    WHERE user_id = $1
      AND direction = 'credit'
      AND reason = 'job_payout'
  `,
    [partnerId],
  );

  return {
    total_applied_open_jobs: parseInt(appliedRes.rows[0]?.c ?? 0, 10),
    total_running_jobs: parseInt(runningRes.rows[0]?.c ?? 0, 10),
    total_completed_jobs: parseInt(completedRes.rows[0]?.c ?? 0, 10),
    total_earnings_credits: parseInt(earnRes.rows[0]?.total_credits ?? 0, 10),
  };
}

async function listPartnerEarnings({ partnerId, page = 1, limit = 20 }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const {
    page: p,
    limit: l,
    offset,
  } = safeLimitOffset({ page, limit, max: 100 });

  const r = await pool.query(
    `
    SELECT
      created_at,
      amount_credits,
      reference_kind,
      reference_id,
      idempotency_key,
      metadata
    FROM wallet_transactions
    WHERE user_id = $1
      AND direction = 'credit'
      AND reason = 'job_payout'
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `,
    [partnerId, l, offset],
  );

  const jobIds = [
    ...new Set(
      (r.rows || [])
        .filter((x) => x.reference_kind === "job" && x.reference_id)
        .map((x) => parseInt(x.reference_id, 10))
        .filter(Number.isFinite),
    ),
  ];

  let jobMap = new Map();
  if (jobIds.length) {
    const jRes = await pool.query(
      `SELECT id, title, client_id, assigned_partner_id, status FROM jobs WHERE id = ANY($1::bigint[])`,
      [jobIds],
    );
    jobMap = new Map(jRes.rows.map((j) => [j.id, j]));
  }

  const items = (r.rows || []).map((x) => {
    const jobId =
      x.reference_kind === "job" ? parseInt(x.reference_id, 10) : null;
    const job = jobId ? jobMap.get(jobId) : null;
    return {
      created_at: x.created_at,
      amount_credits: parseInt(x.amount_credits, 10),
      job: job
        ? {
            id: job.id,
            title: job.title,
            status: job.status,
            client_id: job.client_id,
          }
        : jobId
          ? { id: jobId }
          : null,
      metadata: x.metadata || {},
    };
  });

  return { page: p, limit: l, earnings: items };
}

// -------------------------
module.exports = {
  createJob,
  listClientJobs,
  getJobDetailForClient,

  // partner browsing
  listOpenJobs,
  getJobDetailForPartner,

  upsertJobApplication,
  withdrawJobApplication,

  assignJobAndHoldEscrow,

  partnerMarkComplete,
  clientApproveCompleteAndRelease,

  getPartnerStats,
  listPartnerEarnings,
};
