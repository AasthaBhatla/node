// services/taskService.js
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

async function getOptionIntAny(client, keys, fallback) {
  for (const key of keys) {
    const value = await getOptionInt(client, key, null);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function parseIntList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => parseInt(item, 10)).filter((item) => Number.isInteger(item) && item > 0);
  }
  return String(value || "")
    .split(",")
    .map((item) => parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function parseBoolFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).toLowerCase().trim();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function parseStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
async function createTask({
  clientId,
  title,
  case_description,
  case_type = null,
  category_term_id = null,
  type_term_id = null,
  location_id = null,
  urgency,
  execution_mode = null,
  registration_required = false,
  notarisation_required = false,
  budget_credits = 0,
  attachments = [],
  posting_fee_idempotency_key = null,
  metadata = {},
}) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  let urg = String(urgency || "")
    .toLowerCase()
    .trim();
  if (urg === "urgent" || urg === "immediate") urg = "critical";
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

    const taskRes = await client.query(
      `INSERT INTO tasks
        (
          client_id,
          title,
          case_description,
          case_type,
          category_term_id,
          type_term_id,
          location_id,
          urgency,
          execution_mode,
          registration_required,
          notarisation_required,
          budget_credits,
          status,
          metadata
        )
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'open', $13)
       RETURNING *`,
      [
        clientId,
        String(title || "").trim(),
        String(case_description || "").trim(),
        case_type ? String(case_type).trim() : null,
        category_term_id ? parseInt(category_term_id, 10) : null,
        type_term_id ? parseInt(type_term_id, 10) : null,
        location_id ? parseInt(location_id, 10) : null,
        urg,
        execution_mode ? String(execution_mode).trim() : null,
        !!registration_required,
        !!notarisation_required,
        budget,
        JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
      ],
    );

    const task = taskRes.rows[0];

    for (const url of att) {
      await client.query(
        `INSERT INTO task_attachments (task_id, url) VALUES ($1, $2)`,
        [task.id, url],
      );
    }

    const defaultFee = 500;
    const postFee = await getOptionIntAny(
      client,
      ["task_post_fee_credits", "job_post_fee_credits"],
      defaultFee,
    );
    const freeCount = await getOptionIntAny(
      client,
      ["free_task_posts_count", "free_job_posts_count"],
      0,
    );

    const countRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM tasks WHERE client_id = $1`,
      [clientId],
    );
    const alreadyPosted = parseInt(countRes.rows[0]?.c ?? 0, 10);

    const feeToCharge = alreadyPosted <= freeCount ? 0 : postFee;

    if (feeToCharge > 0) {
      const idem = posting_fee_idempotency_key
        ? String(posting_fee_idempotency_key)
        : `task_post_fee:${task.id}:${clientId}`;

      const debit = await walletDebitTx(client, {
        userId: clientId,
        amount: feeToCharge,
        reason: "task_post_fee",
        reference_kind: "task",
        reference_id: String(task.id),
        idempotency_key: idem,
        metadata: { kind: "task_post_fee", task_id: task.id },
      });

      await client.query(
        `INSERT INTO task_posting_fees
          (task_id, client_id, amount_credits, idempotency_key)
         VALUES
          ($1, $2, $3, $4)
         ON CONFLICT (task_id) DO NOTHING`,
        [task.id, clientId, feeToCharge, idem],
      );

      if (debit.inserted) {
        await bumpPlatformWallet(client, feeToCharge);
      }
    }

    await client.query("COMMIT");

    return {
      task,
      job: task,
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
async function listClientTasks({
  clientId,
  page = 1,
  limit = 20,
  includeApplicants = false,
}) {
  // Auth guard
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const {
    page: p,
    limit: l,
    offset,
  } = safeLimitOffset({
    page,
    limit,
    max: 100,
  });

  // 1) Fetch tasks (with applicant_count for quick UI badges)
  const tasksRes = await pool.query(
    `
    SELECT
      j.*,
      (
        SELECT COUNT(*)::int
        FROM task_applications a
        WHERE a.task_id = j.id
          AND a.status = 'applied'
      ) AS applicant_count
    FROM tasks j
    WHERE j.client_id = $1
    ORDER BY j.created_at DESC
    LIMIT $2 OFFSET $3
    `,
    [clientId, l, offset],
  );

  const tasks = tasksRes.rows || [];

  // If not requested, or no tasks, return early
  if (!includeApplicants || tasks.length === 0) {
    return { page: p, limit: l, tasks, jobs: tasks };
  }

  const taskIds = tasks.map((j) => j.id);

  // 2) Fetch applications for those tasks (exclude withdrawn)
  const appsRes = await pool.query(
    `
    SELECT
      a.task_id,
      a.partner_id,
      a.quote_credits,
      a.message,
      a.status,
      a.created_at,
      a.updated_at
    FROM task_applications a
    WHERE a.task_id = ANY($1::bigint[])
      AND a.status <> 'withdrawn'
    ORDER BY a.created_at DESC
    `,
    [taskIds],
  );

  const apps = appsRes.rows || [];

  // 3) Fetch partner cards for application partners (if any)
  const partnerIds = [
    ...new Set(apps.map((a) => a.partner_id).filter(Boolean)),
  ];

  let partnerMap = new Map();
  if (partnerIds.length > 0) {
    // getUserCardsByIds MUST already exclude sensitive fields (email/phone)
    // and ideally only return safe "card" info.
    const partnerCards = await getUserCardsByIds(partnerIds);

    // Optional: if you want to enforce allowed partner roles at this layer,
    // uncomment below and ensure cards include "role".
    //
    // const allowed = new Set(["officers", "lawyers", "ngos", "experts"]);
    // const filteredCards = (partnerCards || []).filter(
    //   (u) => allowed.has(String(u.role || "").toLowerCase().trim())
    // );

    partnerMap = new Map((partnerCards || []).map((u) => [u.id, u]));
  }

  // 4) Group applications by task_id
  const appsByTask = new Map();
  for (const a of apps) {
    const taskId = a.task_id;
    if (!appsByTask.has(taskId)) appsByTask.set(taskId, []);

    appsByTask.get(taskId).push({
      partner: partnerMap.get(a.partner_id) || {
        id: a.partner_id,
        metadata: {},
      },
      quote_credits:
        a.quote_credits === null || a.quote_credits === undefined
          ? null
          : Number.parseInt(a.quote_credits, 10),
      message: a.message || "",
      status: a.status,
      created_at: a.created_at,
      updated_at: a.updated_at,
    });
  }

  // 5) Attach applications to tasks
  const finalTasks = tasks.map((j) => ({
    ...j,
    applications: appsByTask.get(j.id) || [],
  }));

  return { page: p, limit: l, tasks: finalTasks, jobs: finalTasks };
}

// -------------------------
// JOB: Detail (client view)
// -------------------------
async function getTaskDetailForClient({ clientId, taskId }) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(taskId);
  if (!jid) {
    const e = new Error("Invalid task_id");
    e.statusCode = 400;
    throw e;
  }

  const taskRes = await pool.query(`SELECT * FROM tasks WHERE id = $1 LIMIT 1`, [
    jid,
  ]);
  const task = taskRes.rows[0];
  if (!task || task.client_id !== clientId) {
    const e = new Error("Task not found");
    e.statusCode = 404;
    throw e;
  }

  const attRes = await pool.query(
    `SELECT id, url, created_at FROM task_attachments WHERE task_id = $1 ORDER BY created_at ASC`,
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
    FROM task_applications
    WHERE task_id = $1
    ORDER BY created_at DESC
  `,
    [jid],
  );

  const apps = appsRes.rows || [];
  const partnerIds = [...new Set(apps.map((a) => a.partner_id))];
  const partnerCards = await getUserCardsByIds(partnerIds);
  const partnerMap = new Map(partnerCards.map((u) => [u.id, u]));

  return {
    task,
    job: task,
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
// NEW: Partner - list open tasks (pagination)
// - shows applicant_count
// - does NOT include applicant list (keeps it light)
// - hides "my application" here; that is in detail endpoint
// -------------------------
async function listOpenTasks({
  partnerId,
  page = 1,
  limit = 20,
  q = "",
  category_term_ids = null,
  categories = null,
  type_term_ids = null,
  types = null,
  location_ids = null,
  jurisdictions = null,
  registration_required = null,
  notarisation_required = null,
  execution_mode = null,
  execution = null,
}) {
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

  const values = [];
  const where = ["j.status = 'open'", "j.assigned_partner_id IS NULL"];

  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  const categoryIds = parseIntList(category_term_ids);
  if (categoryIds.length) {
    where.push(`j.category_term_id = ANY(${addValue(categoryIds)}::int[])`);
  }
  const categoryTexts = parseStringList(categories);
  if (categoryTexts.length) {
    const checks = categoryTexts.map((item) => {
      const param = addValue(`%${item}%`);
      return `(COALESCE(j.case_type, '') ILIKE ${param} OR j.metadata::text ILIKE ${param})`;
    });
    where.push(`(${checks.join(" OR ")})`);
  }

  const typeIds = parseIntList(type_term_ids);
  if (typeIds.length) {
    where.push(`j.type_term_id = ANY(${addValue(typeIds)}::int[])`);
  }
  const typeTexts = parseStringList(types);
  if (typeTexts.length) {
    const checks = typeTexts.map((item) => {
      const param = addValue(`%${item}%`);
      return `(COALESCE(j.case_type, '') ILIKE ${param} OR j.metadata::text ILIKE ${param})`;
    });
    where.push(`(${checks.join(" OR ")})`);
  }

  const locationIds = parseIntList(location_ids);
  if (locationIds.length) {
    where.push(`j.location_id = ANY(${addValue(locationIds)}::int[])`);
  }
  const jurisdictionTexts = parseStringList(jurisdictions);
  if (jurisdictionTexts.length) {
    const checks = jurisdictionTexts.map((item) => {
      const param = addValue(`%${item}%`);
      return `j.metadata::text ILIKE ${param}`;
    });
    where.push(`(${checks.join(" OR ")})`);
  }

  const executionItems = parseStringList(execution).map((item) => item.toLowerCase());

  const registrationRequired =
    parseBoolFilter(registration_required) ??
    (executionItems.includes("registration_required") ? true : null);
  if (registrationRequired !== null) {
    where.push(`j.registration_required = ${addValue(registrationRequired)}`);
  }

  const notarisationRequired =
    parseBoolFilter(notarisation_required) ??
    (executionItems.includes("notarisation_required") ? true : null);
  if (notarisationRequired !== null) {
    where.push(`j.notarisation_required = ${addValue(notarisationRequired)}`);
  }

  const executionMode = String(execution_mode || "").trim();
  if (executionMode) {
    where.push(`LOWER(COALESCE(j.execution_mode, '')) = LOWER(${addValue(executionMode)})`);
  }

  const search = String(q || "").trim();
  if (search) {
    const param = addValue(`%${search}%`);
    where.push(`(
      j.title ILIKE ${param}
      OR j.case_description ILIKE ${param}
      OR COALESCE(j.case_type, '') ILIKE ${param}
      OR COALESCE(j.execution_mode, '') ILIKE ${param}
      OR j.metadata::text ILIKE ${param}
    )`);
  }

  const limitParam = addValue(l);
  const offsetParam = addValue(offset);

  const r = await pool.query(
    `
    SELECT
      j.*,
      (
        SELECT COUNT(*)::int
        FROM task_applications a
        WHERE a.task_id = j.id
          AND a.status = 'applied'
      ) AS applicant_count
    FROM tasks j
    WHERE ${where.join(" AND ")}
    ORDER BY j.created_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `,
    values,
  );

  const tasks = r.rows || [];
  return { page: p, limit: l, tasks, jobs: tasks };
}

// -------------------------
// NEW: Partner - task detail
// - allows partner to view open tasks + assigned-to-me tasks
// - includes attachments
// - includes my_application (if exists)
// - includes applicant_count (useful to show competition)
// NOTE: We deliberately do NOT expose all applicants to a partner.
// -------------------------
async function getTaskDetailForPartner({ partnerId, taskId }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const jid = parsePosInt(taskId);
  if (!jid) {
    const e = new Error("Invalid task_id");
    e.statusCode = 400;
    throw e;
  }

  const taskRes = await pool.query(
    `
    SELECT
      j.*,
      (
        SELECT COUNT(*)::int
        FROM task_applications a
        WHERE a.task_id = j.id
          AND a.status = 'applied'
      ) AS applicant_count
    FROM tasks j
    WHERE j.id = $1
    LIMIT 1
  `,
    [jid],
  );

  const task = taskRes.rows[0];
  if (!task) {
    const e = new Error("Task not found");
    e.statusCode = 404;
    throw e;
  }

  // Visibility rules for partner:
  // - If OPEN and unassigned => ok
  // - If assigned => only assigned partner can view (running task)
  const isOpenPublic = task.status === "open" && !task.assigned_partner_id;
  const isMineAssigned = task.assigned_partner_id === partnerId;

  if (!isOpenPublic && !isMineAssigned) {
    const e = new Error("Task not found");
    e.statusCode = 404;
    throw e;
  }

  const attRes = await pool.query(
    `SELECT id, url, created_at FROM task_attachments WHERE task_id = $1 ORDER BY created_at ASC`,
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
    FROM task_applications
    WHERE task_id = $1 AND partner_id = $2
    LIMIT 1
  `,
    [jid, partnerId],
  );

  const my = myAppRes.rows[0] || null;

  return {
    task,
    job: task,
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
async function upsertTaskApplication({
  partnerId,
  taskId,
  quote_credits,
  message = null,
}) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(taskId);
  if (!jid) {
    const e = new Error("Invalid task_id");
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
       FROM tasks
       WHERE id = $1
       FOR UPDATE`,
      [jid],
    );
    const task = jRes.rows[0];
    if (!task) {
      const e = new Error("Task not found");
      e.statusCode = 404;
      throw e;
    }
    if (task.status !== "open" || task.assigned_partner_id) {
      const e = new Error("Task is not open for applications");
      e.statusCode = 400;
      throw e;
    }

    await client.query(
      `
      INSERT INTO task_applications
        (task_id, partner_id, quote_credits, message, status, withdrawn_at)
      VALUES
        ($1, $2, $3, $4, 'applied', NULL)
      ON CONFLICT (task_id, partner_id)
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
    return { message: "Application saved", task_id: jid, partner_id: partnerId };
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

async function withdrawTaskApplication({ partnerId, taskId }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(taskId);
  if (!jid) {
    const e = new Error("Invalid task_id");
    e.statusCode = 400;
    throw e;
  }

  const r = await pool.query(
    `
    UPDATE task_applications
    SET status = 'withdrawn',
        withdrawn_at = NOW(),
        updated_at = NOW()
    WHERE task_id = $1 AND partner_id = $2
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
    task_id: jid,
    partner_id: partnerId,
  };
}

// -------------------------
// ASSIGN + ESCROW HOLD (client)
// -------------------------
async function assignTaskAndHoldEscrow({
  clientId,
  taskId,
  partnerId,
  escrow_idempotency_key,
}) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(taskId);
  const pid = parsePosInt(partnerId);
  if (!jid || !pid) {
    const e = new Error("Invalid task_id or partner_id");
    e.statusCode = 400;
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const jRes = await client.query(
      `SELECT * FROM tasks WHERE id = $1 FOR UPDATE`,
      [jid],
    );
    const task = jRes.rows[0];
    if (!task || task.client_id !== clientId) {
      const e = new Error("Task not found");
      e.statusCode = 404;
      throw e;
    }

    if (task.status !== "open" || task.assigned_partner_id) {
      const e = new Error("Task is not assignable");
      e.statusCode = 400;
      throw e;
    }

    const aRes = await client.query(
      `
      SELECT quote_credits, status
      FROM task_applications
      WHERE task_id = $1 AND partner_id = $2
      LIMIT 1
    `,
      [jid, pid],
    );
    const app = aRes.rows[0];
    if (!app || app.status !== "applied") {
      const e = new Error("Partner has no active application for this task");
      e.statusCode = 400;
      throw e;
    }

    const quote = parseInt(app.quote_credits, 10);
    assertPosInt(quote, "quote_credits must be positive");

    const idem = escrow_idempotency_key
      ? String(escrow_idempotency_key)
      : `task_escrow_hold:${jid}:${clientId}:${pid}`;

    const debit = await walletDebitTx(client, {
      userId: clientId,
      amount: quote,
      reason: "task_escrow_hold",
      reference_kind: "task",
      reference_id: String(jid),
      idempotency_key: idem,
      metadata: { kind: "escrow_hold", task_id: jid, partner_id: pid },
    });

    const escRes = await client.query(
      `
      INSERT INTO task_escrow
        (task_id, client_id, partner_id, amount_credits, status, held_at)
      VALUES
        ($1, $2, $3, $4, 'held', NOW())
      ON CONFLICT (task_id) DO UPDATE
      SET partner_id = EXCLUDED.partner_id,
          amount_credits = EXCLUDED.amount_credits
      RETURNING id, status
    `,
      [jid, clientId, pid, quote],
    );
    const escrowId = escRes.rows[0].id;

      await client.query(
        `
      INSERT INTO task_escrow_events
        (escrow_id, kind, amount_credits, idempotency_key, metadata)
      VALUES
        ($1, 'hold', $2, $3, $4)
      ON CONFLICT (idempotency_key) DO NOTHING
    `,
      [
        escrowId,
        quote,
        idem,
        JSON.stringify({ task_id: jid, client_id: clientId, partner_id: pid }),
      ],
    );

    if (debit.inserted) {
      await bumpPlatformWallet(client, quote);
    }

    await client.query(
      `
      UPDATE tasks
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
      UPDATE task_applications
      SET status = CASE
        WHEN partner_id = $2 THEN 'accepted'
        WHEN status = 'applied' THEN 'rejected'
        ELSE status
      END,
      updated_at = NOW()
      WHERE task_id = $1
    `,
      [jid, pid],
    );

    await client.query("COMMIT");

    return {
      message: debit.inserted
        ? "Task assigned and escrow held"
        : "Task assignment already applied (idempotent)",
      task_id: jid,
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
async function partnerMarkComplete({ partnerId, taskId }) {
  if (!partnerId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(taskId);
  if (!jid) {
    const e = new Error("Invalid task_id");
    e.statusCode = 400;
    throw e;
  }

  const r = await pool.query(
    `
    UPDATE tasks
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
    const e = new Error("Task not found / not assigned to you / invalid status");
    e.statusCode = 400;
    throw e;
  }

  return { message: "Completion requested", task_id: jid };
}

async function clientApproveCompleteAndRelease({
  clientId,
  taskId,
  release_idempotency_key,
}) {
  if (!clientId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  const jid = parsePosInt(taskId);
  if (!jid) {
    const e = new Error("Invalid task_id");
    e.statusCode = 400;
    throw e;
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const jRes = await dbClient.query(
      `SELECT * FROM tasks WHERE id = $1 FOR UPDATE`,
      [jid],
    );
    const task = jRes.rows[0];
    if (!task || task.client_id !== clientId) {
      const e = new Error("Task not found");
      e.statusCode = 404;
      throw e;
    }

    if (!task.assigned_partner_id) {
      const e = new Error("Task is not assigned");
      e.statusCode = 400;
      throw e;
    }

    if (
      !["completion_requested", "assigned", "in_progress"].includes(task.status)
    ) {
      const e = new Error("Task is not in a completable state");
      e.statusCode = 400;
      throw e;
    }

    const eRes = await dbClient.query(
      `
      SELECT * FROM task_escrow
      WHERE task_id = $1
      FOR UPDATE
    `,
      [jid],
    );
    const escrow = eRes.rows[0];
    if (!escrow || escrow.status !== "held") {
      const e = new Error("No held escrow found for this task");
      e.statusCode = 400;
      throw e;
    }

    const amount = parseInt(escrow.amount_credits, 10);
    assertPosInt(amount, "Invalid escrow amount");

    const idem = release_idempotency_key
      ? String(release_idempotency_key)
      : `task_escrow_release:${jid}:${escrow.partner_id}`;

    const credit = await walletCreditTx(dbClient, {
      userId: escrow.partner_id,
      amount,
      reason: "task_payout",
      reference_kind: "task",
      reference_id: String(jid),
      idempotency_key: idem,
      metadata: { kind: "escrow_release", task_id: jid, client_id: clientId },
    });

    await dbClient.query(
      `
      INSERT INTO task_escrow_events
        (escrow_id, kind, amount_credits, idempotency_key, metadata)
      VALUES
        ($1, 'release', $2, $3, $4)
      ON CONFLICT (idempotency_key) DO NOTHING
    `,
      [
        escrow.id,
        amount,
        idem,
        JSON.stringify({ task_id: jid, partner_id: escrow.partner_id }),
      ],
    );

    if (credit.inserted) {
      await dbClient.query(
        `
        UPDATE task_escrow
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
      UPDATE tasks
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
        ? "Task completed and payout released"
        : "Payout already released (idempotent)",
      task_id: jid,
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
    FROM task_applications a
    JOIN tasks j ON j.id = a.task_id
    WHERE a.partner_id = $1
      AND a.status = 'applied'
      AND j.status = 'open'
  `,
    [partnerId],
  );

  const runningRes = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM tasks
    WHERE assigned_partner_id = $1
      AND status NOT IN ('completed', 'cancelled', 'refunded')
  `,
    [partnerId],
  );

  const completedRes = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM tasks
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
      AND reason = 'task_payout'
  `,
    [partnerId],
  );

  return {
    total_applied_open_tasks: parseInt(appliedRes.rows[0]?.c ?? 0, 10),
    total_applied_open_jobs: parseInt(appliedRes.rows[0]?.c ?? 0, 10),
    total_running_tasks: parseInt(runningRes.rows[0]?.c ?? 0, 10),
    total_running_jobs: parseInt(runningRes.rows[0]?.c ?? 0, 10),
    total_completed_tasks: parseInt(completedRes.rows[0]?.c ?? 0, 10),
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
      AND reason = 'task_payout'
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `,
    [partnerId, l, offset],
  );

  const taskIds = [
    ...new Set(
      (r.rows || [])
        .filter((x) => x.reference_kind === "task" && x.reference_id)
        .map((x) => parseInt(x.reference_id, 10))
        .filter(Number.isFinite),
    ),
  ];

  let taskMap = new Map();
  if (taskIds.length) {
    const jRes = await pool.query(
      `SELECT id, title, client_id, assigned_partner_id, status FROM tasks WHERE id = ANY($1::bigint[])`,
      [taskIds],
    );
    taskMap = new Map(jRes.rows.map((j) => [j.id, j]));
  }

  const items = (r.rows || []).map((x) => {
    const taskId =
      x.reference_kind === "task" ? parseInt(x.reference_id, 10) : null;
    const task = taskId ? taskMap.get(taskId) : null;
    return {
      created_at: x.created_at,
      amount_credits: parseInt(x.amount_credits, 10),
      task: task
        ? {
            id: task.id,
            title: task.title,
            status: task.status,
            client_id: task.client_id,
          }
        : taskId
          ? { id: taskId }
          : null,
      job: task
        ? {
            id: task.id,
            title: task.title,
            status: task.status,
            client_id: task.client_id,
          }
        : taskId
          ? { id: taskId }
          : null,
      metadata: x.metadata || {},
    };
  });

  return { page: p, limit: l, earnings: items };
}

async function listAdminTasks({ page = 1, limit = 50, status = "", q = "" } = {}) {
  const {
    page: p,
    limit: l,
    offset,
  } = safeLimitOffset({ page, limit, max: 100 });

  const values = [];
  const where = [];
  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  const statusText = String(status || "").trim().toLowerCase();
  if (statusText && statusText !== "all") {
    assertEnum(
      statusText,
      [
        "open",
        "assigned",
        "in_progress",
        "completion_requested",
        "completed",
        "disputed",
        "cancelled",
        "refunded",
      ],
      "Invalid status filter",
    );
    where.push(`t.status = ${addValue(statusText)}::task_status`);
  }

  const search = String(q || "").trim();
  if (search) {
    const param = addValue(`%${search}%`);
    where.push(`(
      t.title ILIKE ${param}
      OR t.case_description ILIKE ${param}
      OR COALESCE(t.case_type, '') ILIKE ${param}
      OR t.metadata::text ILIKE ${param}
    )`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM tasks t ${whereSql}`,
    values,
  );

  const limitParam = addValue(l);
  const offsetParam = addValue(offset);
  const rowsRes = await pool.query(
    `
    SELECT
      t.*,
      (
        SELECT COUNT(*)::int
        FROM task_applications a
        WHERE a.task_id = t.id
          AND a.status <> 'withdrawn'
      ) AS application_count,
      e.amount_credits AS escrow_amount_credits,
      e.status AS escrow_status,
      e.held_at AS escrow_held_at,
      e.released_at AS escrow_released_at
    FROM tasks t
    LEFT JOIN task_escrow e ON e.task_id = t.id
    ${whereSql}
    ORDER BY t.created_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    values,
  );

  return {
    page: p,
    limit: l,
    total: parseInt(countRes.rows[0]?.total ?? 0, 10),
    tasks: rowsRes.rows || [],
  };
}

async function getTaskDetailForAdmin({ taskId }) {
  const tid = parsePosInt(taskId);
  if (!tid) {
    const e = new Error("Invalid task_id");
    e.statusCode = 400;
    throw e;
  }

  const taskRes = await pool.query(`SELECT * FROM tasks WHERE id = $1 LIMIT 1`, [
    tid,
  ]);
  const task = taskRes.rows[0];
  if (!task) {
    const e = new Error("Task not found");
    e.statusCode = 404;
    throw e;
  }

  const attachmentsRes = await pool.query(
    `SELECT id, url, created_at FROM task_attachments WHERE task_id = $1 ORDER BY created_at ASC`,
    [tid],
  );
  const appsRes = await pool.query(
    `
    SELECT partner_id, quote_credits, message, status, created_at, updated_at, withdrawn_at
    FROM task_applications
    WHERE task_id = $1
    ORDER BY created_at DESC
    `,
    [tid],
  );
  const escrowRes = await pool.query(
    `SELECT * FROM task_escrow WHERE task_id = $1 LIMIT 1`,
    [tid],
  );

  const partnerIds = [...new Set((appsRes.rows || []).map((row) => row.partner_id))];
  const partnerCards = partnerIds.length ? await getUserCardsByIds(partnerIds) : [];
  const partnerMap = new Map(partnerCards.map((partner) => [partner.id, partner]));

  return {
    task,
    attachments: attachmentsRes.rows || [],
    applications: (appsRes.rows || []).map((row) => ({
      partner: partnerMap.get(row.partner_id) || { id: row.partner_id, metadata: {} },
      quote_credits: parseInt(row.quote_credits, 10),
      message: row.message || "",
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      withdrawn_at: row.withdrawn_at,
    })),
    escrow: escrowRes.rows[0] || null,
  };
}

// -------------------------
module.exports = {
  createTask,
  listClientTasks,
  getTaskDetailForClient,

  // partner browsing
  listOpenTasks,
  getTaskDetailForPartner,

  upsertTaskApplication,
  withdrawTaskApplication,

  assignTaskAndHoldEscrow,

  partnerMarkComplete,
  clientApproveCompleteAndRelease,

  getPartnerStats,
  listPartnerEarnings,
  listAdminTasks,
  getTaskDetailForAdmin,
};
