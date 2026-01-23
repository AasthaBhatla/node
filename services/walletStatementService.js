// services/walletStatementService.js
const pool = require("../db");

const parsePosInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function isAdmin(user) {
  return String(user?.role || "").toLowerCase() === "admin";
}

function resolveTargetUserId(authUser, requestedUserId) {
  const meId = parsePosInt(authUser?.id);
  if (!meId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  if (requestedUserId && requestedUserId !== meId) {
    if (!isAdmin(authUser)) {
      const e = new Error(
        "Forbidden: admin required to view other user's statement",
      );
      e.statusCode = 403;
      throw e;
    }
    return requestedUserId;
  }

  return meId;
}

/**
 * Fetch users + ALL metadata (aggregated) for a list of IDs.
 * - Admin gets email/phone
 * - Non-admin does NOT get email/phone
 */
async function getUsersWithAllMetadata(userIds = []) {
  if (!Array.isArray(userIds) || userIds.length === 0) return new Map();

  // 1) base users (NO email/phone/language/location)
  const usersRes = await pool.query(
    `
    SELECT id, status, role, created_at
    FROM users
    WHERE id = ANY($1::int[])
  `,
    [userIds],
  );

  // 2) all metadata (no whitelist)
  const metaRes = await pool.query(
    `
    SELECT user_id, key, value
    FROM user_metadata
    WHERE user_id = ANY($1::int[])
  `,
    [userIds],
  );

  const metaMap = new Map(); // user_id -> {k:v}
  for (const row of metaRes.rows) {
    const uid = row.user_id;
    if (!metaMap.has(uid)) metaMap.set(uid, {});
    metaMap.get(uid)[row.key] = row.value;
  }

  const map = new Map(); // user_id -> userObject
  for (const u of usersRes.rows) {
    map.set(u.id, {
      id: u.id,
      status: u.status,
      role: u.role,
      created_at: u.created_at,
      metadata: metaMap.get(u.id) || {},
    });
  }

  return map;
}

/**
 * Returns session-wise statement (not minute-wise).
 * Includes both participants + full metadata for both.
 */
exports.listSessionStatement = async ({
  authUser,
  requestedUserId = null,
  limit = 50,
  offset = 0,
  status = null,
  session_type = null,
}) => {
  const adminView = isAdmin(authUser);
  const targetUserId = resolveTargetUserId(authUser, requestedUserId);

  const safeLimit =
    Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

  const filters = [];
  const params = [targetUserId, safeLimit, safeOffset];

  if (status) {
    params.push(String(status));
    filters.push(`s.status = $${params.length}`);
  }
  if (session_type) {
    params.push(String(session_type));
    filters.push(`s.session_type = $${params.length}`);
  }

  const whereExtra = filters.length ? `AND ${filters.join(" AND ")}` : "";

  const q = `
    SELECT
      s.session_id,
      s.user_id AS client_id,
      s.partner_id,
      s.session_type,
      s.status,
      s.rate_credits_per_min,
      s.started_at,
      s.ended_at,
      s.ended_reason,
      s.total_minutes_billed,
      s.total_credits_billed,

      CASE WHEN s.user_id = $1 THEN 'client' ELSE 'partner' END AS my_side,
      CASE WHEN s.user_id = $1 THEN 'debit' ELSE 'credit' END AS my_direction,

      CASE WHEN s.user_id = $1 THEN s.total_credits_billed ELSE 0 END AS debit_credits,
      CASE WHEN s.partner_id = $1 THEN s.total_credits_billed ELSE 0 END AS credit_credits,

      CASE WHEN s.user_id = $1 THEN s.partner_id ELSE s.user_id END AS counterparty_id
    FROM sessions s
    WHERE (s.user_id = $1 OR s.partner_id = $1)
      ${whereExtra}
    ORDER BY s.started_at DESC
    LIMIT $2 OFFSET $3
  `;

  const r = await pool.query(q, params);

  const rows = r.rows || [];
  const ids = new Set();
  for (const row of rows) {
    ids.add(row.client_id);
    ids.add(row.partner_id);
    if (row.counterparty_id) ids.add(row.counterparty_id);
  }

  const peopleMap = await getUsersWithAllMetadata([...ids]);

  const sessions = rows.map((row) => {
    const client = peopleMap.get(row.client_id) || {
      id: row.client_id,
      metadata: {},
    };
    const partner = peopleMap.get(row.partner_id) || {
      id: row.partner_id,
      metadata: {},
    };
    const counterparty = peopleMap.get(row.counterparty_id) || {
      id: row.counterparty_id,
      metadata: {},
    };

    return {
      session_id: row.session_id,
      session_type: row.session_type,
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at,
      ended_reason: row.ended_reason,

      rate_credits_per_min: row.rate_credits_per_min,
      duration_minutes: row.total_minutes_billed,
      amount_credits: row.total_credits_billed,

      my_side: row.my_side,
      my_direction: row.my_direction,
      debit_credits: parseInt(row.debit_credits || 0, 10),
      credit_credits: parseInt(row.credit_credits || 0, 10),

      people: {
        client,
        partner,
        counterparty,
      },
    };
  });

  return {
    user_id: targetUserId,
    is_admin_view: adminView,
    limit: safeLimit,
    offset: safeOffset,
    sessions,
  };
};

/**
 * One session statement (authorization enforced).
 * - User can only access if they are client or partner
 * - Admin can access any session
 */
exports.getSessionStatementById = async ({ authUser, sessionId }) => {
  const sid = parsePosInt(sessionId);
  if (!sid) {
    const e = new Error("Invalid session_id");
    e.statusCode = 400;
    throw e;
  }

  const meId = parsePosInt(authUser?.id);
  if (!meId) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const adminView = isAdmin(authUser);

  const q = adminView
    ? `
      SELECT s.*
      FROM sessions s
      WHERE s.session_id = $1
      LIMIT 1
    `
    : `
      SELECT s.*
      FROM sessions s
      WHERE s.session_id = $1
        AND (s.user_id = $2 OR s.partner_id = $2)
      LIMIT 1
    `;

  const params = adminView ? [sid] : [sid, meId];

  const r = await pool.query(q, params);
  const s = r.rows[0];
  if (!s) {
    const e = new Error("Session not found");
    e.statusCode = 404;
    throw e;
  }

  const peopleMap = await getUsersWithAllMetadata(
    [s.user_id, s.partner_id],
    adminView,
  );
  const client = peopleMap.get(s.user_id) || { id: s.user_id, metadata: {} };
  const partner = peopleMap.get(s.partner_id) || {
    id: s.partner_id,
    metadata: {},
  };

  // viewpoint if caller is participant; if admin & not participant => null
  let my_side = null;
  let my_direction = null;
  let debit_credits = 0;
  let credit_credits = 0;

  if (s.user_id === meId) {
    my_side = "client";
    my_direction = "debit";
    debit_credits = s.total_credits_billed;
  } else if (s.partner_id === meId) {
    my_side = "partner";
    my_direction = "credit";
    credit_credits = s.total_credits_billed;
  }

  return {
    is_admin_view: adminView,
    session: {
      session_id: s.session_id,
      session_type: s.session_type,
      status: s.status,
      started_at: s.started_at,
      ended_at: s.ended_at,
      ended_reason: s.ended_reason,

      rate_credits_per_min: s.rate_credits_per_min,
      duration_minutes: s.total_minutes_billed,
      amount_credits: s.total_credits_billed,

      my_side,
      my_direction,
      debit_credits,
      credit_credits,

      people: {
        client,
        partner,
      },

      metadata: s.metadata,
    },
  };
};
