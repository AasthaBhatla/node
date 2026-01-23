// services/sessionService.js
const pool = require("../db");

const assertPosInt = (v) => Number.isInteger(v) && v > 0;

const parsePosInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function ensureWalletRow(client, userId) {
  // ensure user exists
  const u = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!u.rows[0]) {
    const e = new Error("User not found");
    e.statusCode = 404;
    throw e;
  }

  // ensure wallet exists
  await client.query(
    `INSERT INTO wallet (user_id, balance_credits)
     VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

// lock wallets in deterministic order to reduce deadlocks
async function lockWallets(client, userId, partnerId) {
  const a = Math.min(userId, partnerId);
  const b = Math.max(userId, partnerId);

  const wa = await client.query(
    `SELECT user_id, balance_credits
     FROM wallet
     WHERE user_id = $1
     FOR UPDATE`,
    [a],
  );

  const wb = await client.query(
    `SELECT user_id, balance_credits
     FROM wallet
     WHERE user_id = $1
     FOR UPDATE`,
    [b],
  );

  const map = new Map();
  if (wa.rows[0]) map.set(wa.rows[0].user_id, wa.rows[0]);
  if (wb.rows[0]) map.set(wb.rows[0].user_id, wb.rows[0]);
  return map;
}

function computeShouldHaveMinutes(startedAt, now = new Date()) {
  const started = new Date(startedAt);
  const diffMs = now.getTime() - started.getTime();
  if (diffMs < 0) return 0;

  // minute 1 billed immediately at start
  const elapsedFullMinutes = Math.floor(diffMs / 60000);
  return elapsedFullMinutes + 1;
}

/**
 * Bills exactly one minute (minuteIndex) atomically.
 * Uses BOTH:
 *  - session_minutes unique(session_id, minute_index)
 *  - wallet_transactions idempotency_key unique
 *
 * Also IMPORTANT: reference_id is minute-specific to avoid your ux_wallet_tx_ref_unique collisions.
 */
async function billOneMinuteTx({
  client,
  session,
  minuteIndex,
  now = new Date(),
}) {
  const {
    session_id,
    user_id,
    partner_id,
    rate_credits_per_min,
    status,
    session_type,
  } = session;

  if (status !== "active") {
    return { billed: false, reason: "session_not_active" };
  }

  // 1) Insert minute row (idempotent)
  const minuteIns = await client.query(
    `INSERT INTO session_minutes (session_id, minute_index, amount_credits)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, minute_index) DO NOTHING
     RETURNING id`,
    [session_id, minuteIndex, rate_credits_per_min],
  );

  if (minuteIns.rowCount !== 1) {
    return { billed: false, reason: "already_billed" };
  }

  // ensure wallets
  await ensureWalletRow(client, user_id);
  await ensureWalletRow(client, partner_id);

  // lock wallets
  const wallets = await lockWallets(client, user_id, partner_id);
  const userWallet = wallets.get(user_id);
  const partnerWallet = wallets.get(partner_id);

  if (!userWallet) {
    const e = new Error("User wallet not found");
    e.statusCode = 404;
    throw e;
  }
  if (!partnerWallet) {
    const e = new Error("Partner wallet not found");
    e.statusCode = 404;
    throw e;
  }

  // balance check
  if (userWallet.balance_credits < rate_credits_per_min) {
    const e = new Error("Insufficient wallet balance to continue session");
    e.statusCode = 400;
    throw e;
  }

  // ✅ minute-specific reference_id (fixes your unique constraint collisions)
  const debitRefId = `session:${session_id}:m:${minuteIndex}:debit`;
  const creditRefId = `session:${session_id}:m:${minuteIndex}:credit`;

  // ✅ stable idempotency per minute
  const debitKey = debitRefId;
  const creditKey = creditRefId;

  // 2) Debit ledger (idempotent)
  const debitIns = await client.query(
    `INSERT INTO wallet_transactions
      (user_id, direction, amount_credits, reason, reference_kind, reference_id, idempotency_key, metadata)
     VALUES
      ($1, 'debit', $2, 'session', 'session', $3, $4, COALESCE($5, '{}'::jsonb))
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      user_id,
      rate_credits_per_min,
      debitRefId,
      debitKey,
      JSON.stringify({
        minute_index: minuteIndex,
        partner_id,
        session_type,
        at: now.toISOString(),
      }),
    ],
  );

  // 3) Credit ledger (idempotent)
  const creditIns = await client.query(
    `INSERT INTO wallet_transactions
      (user_id, direction, amount_credits, reason, reference_kind, reference_id, idempotency_key, metadata)
     VALUES
      ($1, 'credit', $2, 'session', 'session', $3, $4, COALESCE($5, '{}'::jsonb))
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      partner_id,
      rate_credits_per_min,
      creditRefId,
      creditKey,
      JSON.stringify({
        minute_index: minuteIndex,
        user_id,
        session_type,
        at: now.toISOString(),
      }),
    ],
  );

  // both must insert or we rollback for consistency
  if (debitIns.rowCount !== 1 || creditIns.rowCount !== 1) {
    const e = new Error(
      "Ledger idempotency conflict: minute already processed",
    );
    e.statusCode = 409;
    throw e;
  }

  // 4) Apply balances
  await client.query(
    `UPDATE wallet
     SET balance_credits = balance_credits - $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [rate_credits_per_min, user_id],
  );

  await client.query(
    `UPDATE wallet
     SET balance_credits = balance_credits + $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [rate_credits_per_min, partner_id],
  );

  // 5) Update session totals
  await client.query(
    `UPDATE sessions
     SET total_minutes_billed = total_minutes_billed + 1,
         total_credits_billed = total_credits_billed + $2
     WHERE session_id = $1`,
    [session_id, rate_credits_per_min],
  );

  return { billed: true, minute_index: minuteIndex };
}

exports.startSession = async ({
  userId,
  partnerId,
  sessionType,
  rateCreditsPerMin,
  metadata,
}) => {
  const user_id = parsePosInt(userId);
  const partner_id = parsePosInt(partnerId);

  if (!user_id) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  if (!partner_id) {
    const e = new Error("partner_id must be a positive integer");
    e.statusCode = 400;
    throw e;
  }
  if (partner_id === user_id) {
    const e = new Error("partner_id cannot be same as user");
    e.statusCode = 400;
    throw e;
  }

  const session_type = String(sessionType || "").trim();
  if (!session_type) {
    const e = new Error("session_type is required (e.g. call/chat)");
    e.statusCode = 400;
    throw e;
  }

  const rate = parsePosInt(rateCreditsPerMin);
  if (!rate) {
    const e = new Error("rate_credits_per_min must be a positive integer");
    e.statusCode = 400;
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // validate users
    const u1 = await client.query(`SELECT id FROM users WHERE id = $1`, [
      user_id,
    ]);
    if (!u1.rows[0]) {
      const e = new Error("User not found");
      e.statusCode = 404;
      throw e;
    }

    const u2 = await client.query(`SELECT id, role FROM users WHERE id = $1`, [
      partner_id,
    ]);
    if (!u2.rows[0]) {
      const e = new Error("Partner not found");
      e.statusCode = 404;
      throw e;
    }

    // create session
    const sRes = await client.query(
      `INSERT INTO sessions
        (user_id, partner_id, session_type, status, rate_credits_per_min, metadata)
       VALUES
        ($1, $2, $3, 'active', $4, COALESCE($5, '{}'::jsonb))
       RETURNING *`,
      [
        user_id,
        partner_id,
        session_type,
        rate,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );

    const session = sRes.rows[0];

    // bill minute 1 immediately
    await billOneMinuteTx({
      client,
      session,
      minuteIndex: 1,
      now: new Date(),
    });

    await client.query("COMMIT");
    return { session };
  } catch (err) {
    await client.query("ROLLBACK");
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
};

exports.endSession = async ({ userId, sessionId, endedReason }) => {
  const uid = parsePosInt(userId);
  const sid = parsePosInt(sessionId);

  if (!uid) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  if (!sid) {
    const e = new Error("Invalid session_id");
    e.statusCode = 400;
    throw e;
  }

  const reason = endedReason ? String(endedReason).slice(0, 50) : null;

  const r = await pool.query(
    `UPDATE sessions
     SET status = 'ended',
         ended_at = NOW(),
         ended_reason = COALESCE(ended_reason, $3)
     WHERE session_id = $1 AND user_id = $2 AND status = 'active'
     RETURNING *`,
    [sid, uid, reason],
  );

  if (!r.rows[0]) {
    const e = new Error("Session not found or already ended");
    e.statusCode = 404;
    throw e;
  }

  return { session: r.rows[0] };
};

/**
 * HEARTBEAT BILLING:
 * Frontend calls this at the start of every minute (or burst catch-up).
 * Server computes due minutes using started_at + total_minutes_billed.
 *
 * SECURITY:
 * - only session owner (user_id) can bill their session.
 */
exports.billDueMinutesForSession = async ({
  userId,
  sessionId,
  maxMinutes = 1,
  now = new Date(),
}) => {
  const uid = parsePosInt(userId);
  const sid = parsePosInt(sessionId);

  if (!uid) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
  if (!sid) {
    const e = new Error("Invalid session_id");
    e.statusCode = 400;
    throw e;
  }

  // frontend-controlled, but server-capped
  let cap = Number.isInteger(maxMinutes)
    ? maxMinutes
    : parseInt(maxMinutes, 10);
  if (!Number.isInteger(cap) || cap <= 0) cap = 1;
  if (cap > 10) cap = 10; // hard cap (adjust as you wish)

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ✅ lock session row, AND enforce ownership
    const sRes = await client.query(
      `SELECT *
       FROM sessions
       WHERE session_id = $1 AND user_id = $2
       FOR UPDATE`,
      [sid, uid],
    );

    const session = sRes.rows[0];

    if (!session) {
      const e = new Error("Session not found");
      e.statusCode = 404;
      throw e;
    }

    if (session.status !== "active") {
      await client.query("COMMIT");
      return { session, billed: 0, details: [], reason: "not_active" };
    }

    const shouldHave = computeShouldHaveMinutes(session.started_at, now);
    const already = parseInt(session.total_minutes_billed || 0, 10);

    if (shouldHave <= already) {
      await client.query("COMMIT");
      return { session, billed: 0, details: [], reason: "up_to_date" };
    }

    const toBill = Math.min(cap, shouldHave - already);

    const details = [];
    for (let i = 1; i <= toBill; i++) {
      const minuteIndex = already + i;
      const r = await billOneMinuteTx({
        client,
        session,
        minuteIndex,
        now,
      });
      details.push(r);
    }

    // reload session
    const s2 = await client.query(
      `SELECT * FROM sessions WHERE session_id = $1`,
      [sid],
    );
    await client.query("COMMIT");

    return {
      session: s2.rows[0],
      billed: details.filter((d) => d.billed).length,
      details,
      should_have_minutes: shouldHave,
      already_billed_before: already,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
};

exports.listMySessions = async ({ userId, limit = 50, offset = 0 }) => {
  const uid = parsePosInt(userId);
  if (!uid) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }

  const safeLimit =
    Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

  const r = await pool.query(
    `SELECT *
     FROM sessions
     WHERE user_id = $1
     ORDER BY started_at DESC
     LIMIT $2 OFFSET $3`,
    [uid, safeLimit, safeOffset],
  );

  return { sessions: r.rows, limit: safeLimit, offset: safeOffset };
};
