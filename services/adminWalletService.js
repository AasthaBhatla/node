const pool = require("../db");
const userServices = require("./userService");

const assertPosInt = (value) => Number.isInteger(value) && value > 0;

const ensureWalletRow = async (client, userId) => {
  const targetUserId = parseInt(userId, 10);

  if (!assertPosInt(targetUserId)) {
    const error = new Error("Invalid user_id");
    error.statusCode = 400;
    throw error;
  }

  const userResult = await client.query(`SELECT id FROM users WHERE id = $1`, [
    targetUserId,
  ]);

  if (!userResult.rows[0]) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  await client.query(
    `INSERT INTO wallet (user_id, balance_credits)
     VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [targetUserId],
  );

  return targetUserId;
};

function normalizeTransactionMetadata(metadata) {
  if (!metadata) return {};

  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  return typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

function extractCounterpartyIdFromTx(transaction, currentUserId) {
  const metadata = normalizeTransactionMetadata(transaction.metadata);
  const partnerId = Number(metadata.partner_id);
  if (Number.isFinite(partnerId) && partnerId !== Number(currentUserId)) {
    return partnerId;
  }

  const clientId = Number(metadata.client_id);
  if (Number.isFinite(clientId) && clientId !== Number(currentUserId)) {
    return clientId;
  }

  return null;
}

async function getUserWalletBalanceForAdmin(userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const targetUserId = await ensureWalletRow(client, userId);

    const balanceResult = await client.query(
      `SELECT balance_credits
       FROM wallet
       WHERE user_id = $1`,
      [targetUserId],
    );

    await client.query("COMMIT");

    return {
      user_id: targetUserId,
      balance_credits: Number(balanceResult.rows[0]?.balance_credits ?? 0),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    error.statusCode = error.statusCode || 500;
    throw error;
  } finally {
    client.release();
  }
}

async function getUserWalletTransactionsForAdmin({
  userId,
  limit = 200,
  offset = 0,
}) {
  const safeLimit =
    Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const targetUserId = await ensureWalletRow(client, userId);

    const [transactionsResult, totalResult] = await Promise.all([
      client.query(
        `SELECT
           id,
           created_at,
           direction,
           amount_credits,
           reason,
           reference_kind,
           reference_id,
           idempotency_key,
           metadata
         FROM wallet_transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [targetUserId, safeLimit, safeOffset],
      ),
      client.query(
        `SELECT COUNT(*)::int AS total
         FROM wallet_transactions
         WHERE user_id = $1`,
        [targetUserId],
      ),
    ]);

    const transactions = transactionsResult.rows || [];
    const counterpartyIds = Array.from(
      new Set(
        transactions
          .map((transaction) => extractCounterpartyIdFromTx(transaction, targetUserId))
          .filter((value) => Number.isFinite(value)),
      ),
    );

    let counterpartyMap = {};
    if (counterpartyIds.length > 0) {
      const users = await userServices.getUsersByIds(counterpartyIds);
      counterpartyMap = users.reduce((accumulator, user) => {
        accumulator[user.id] = user;
        return accumulator;
      }, {});
    }

    const enrichedTransactions = transactions.map((transaction) => {
      const metadata = normalizeTransactionMetadata(transaction.metadata);
      const counterpartyId = extractCounterpartyIdFromTx(
        { ...transaction, metadata },
        targetUserId,
      );

      return {
        ...transaction,
        metadata,
        counterparty: counterpartyId ? counterpartyMap[counterpartyId] || null : null,
      };
    });

    await client.query("COMMIT");

    return {
      user_id: targetUserId,
      transactions: enrichedTransactions,
      limit: safeLimit,
      offset: safeOffset,
      total: Number(totalResult.rows[0]?.total ?? 0),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    error.statusCode = error.statusCode || 500;
    throw error;
  } finally {
    client.release();
  }
}

async function getUserWalletSessionGroupsForAdmin({
  userId,
  limit = 50,
  offset = 0,
}) {
  const safeLimit =
    Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const targetUserId = await ensureWalletRow(client, userId);

    const [groupsResult, totalResult] = await Promise.all([
      client.query(
        `WITH session_tx AS (
           SELECT
             wt.id,
             wt.created_at,
             wt.direction,
             wt.amount_credits,
             wt.reason,
             wt.reference_kind,
             wt.reference_id,
             wt.idempotency_key,
             wt.metadata,
             NULLIF(split_part(wt.reference_id, ':', 2), '')::int AS session_id,
             COALESCE(
               NULLIF(wt.metadata->>'minute_index', '')::int,
               NULLIF(split_part(wt.reference_id, ':', 4), '')::int
             ) AS minute_index,
             CASE
               WHEN wt.metadata ? 'partner_id'
                 THEN NULLIF(wt.metadata->>'partner_id', '')::int
               WHEN wt.metadata ? 'user_id'
                 THEN NULLIF(wt.metadata->>'user_id', '')::int
               ELSE NULL
             END AS counterparty_id
           FROM wallet_transactions wt
           WHERE wt.user_id = $1
             AND wt.reference_kind = 'session'
             AND wt.reference_id LIKE 'session:%'
         ),
         grouped AS (
           SELECT
             session_id,
             MIN(created_at) AS first_charged_at,
             MAX(created_at) AS last_charged_at,
             MAX(direction::text) AS direction,
             SUM(amount_credits)::int AS total_credits,
             COUNT(*)::int AS charge_count,
             MAX(counterparty_id) AS counterparty_id,
             json_agg(
               json_build_object(
                 'id', id,
                 'created_at', created_at,
                 'direction', direction,
                 'amount_credits', amount_credits,
                 'reason', reason,
                 'reference_kind', reference_kind,
                 'reference_id', reference_id,
                 'idempotency_key', idempotency_key,
                 'metadata', metadata,
                 'minute_index', minute_index
               )
               ORDER BY COALESCE(minute_index, 0) ASC, created_at ASC
             ) AS charges
           FROM session_tx
           WHERE session_id IS NOT NULL
           GROUP BY session_id
         ),
         ranked AS (
           SELECT *
           FROM grouped
           ORDER BY last_charged_at DESC
           LIMIT $2 OFFSET $3
         )
         SELECT
           ranked.*,
           s.session_type,
           s.status AS session_status,
           s.started_at,
           s.ended_at,
           s.ended_reason,
           s.rate_credits_per_min,
           s.total_minutes_billed,
           s.total_credits_billed
         FROM ranked
         LEFT JOIN sessions s ON s.session_id = ranked.session_id
         ORDER BY ranked.last_charged_at DESC`,
        [targetUserId, safeLimit, safeOffset],
      ),
      client.query(
        `SELECT COUNT(DISTINCT NULLIF(split_part(reference_id, ':', 2), '')::int)::int AS total
         FROM wallet_transactions
         WHERE user_id = $1
           AND reference_kind = 'session'
           AND reference_id LIKE 'session:%'`,
        [targetUserId],
      ),
    ]);

    const rows = groupsResult.rows || [];
    const counterpartyIds = Array.from(
      new Set(
        rows
          .map((row) => Number(row.counterparty_id))
          .filter((value) => Number.isFinite(value)),
      ),
    );

    let counterpartyMap = {};
    if (counterpartyIds.length > 0) {
      const users = await userServices.getUsersByIds(counterpartyIds);
      counterpartyMap = users.reduce((accumulator, user) => {
        accumulator[user.id] = user;
        return accumulator;
      }, {});
    }

    const sessions = rows.map((row) => ({
      session_id: Number(row.session_id),
      first_charged_at: row.first_charged_at,
      last_charged_at: row.last_charged_at,
      direction: String(row.direction || ""),
      total_credits: Number(row.total_credits || 0),
      charge_count: Number(row.charge_count || 0),
      session_type: row.session_type ? String(row.session_type) : "",
      session_status: row.session_status ? String(row.session_status) : "",
      started_at: row.started_at,
      ended_at: row.ended_at,
      ended_reason: row.ended_reason ? String(row.ended_reason) : "",
      rate_credits_per_min: Number(row.rate_credits_per_min || 0),
      total_minutes_billed: Number(row.total_minutes_billed || 0),
      total_credits_billed: Number(row.total_credits_billed || 0),
      counterparty:
        row.counterparty_id && counterpartyMap[row.counterparty_id]
          ? counterpartyMap[row.counterparty_id]
          : null,
      charges: Array.isArray(row.charges)
        ? row.charges.map((charge) => ({
            id: String(charge.id ?? ""),
            created_at: String(charge.created_at ?? ""),
            direction: String(charge.direction ?? ""),
            amount_credits: Number(charge.amount_credits ?? 0),
            reason: String(charge.reason ?? ""),
            reference_kind: String(charge.reference_kind ?? ""),
            reference_id: String(charge.reference_id ?? ""),
            idempotency_key: String(charge.idempotency_key ?? ""),
            metadata: normalizeTransactionMetadata(charge.metadata),
            minute_index: Number(charge.minute_index ?? 0),
          }))
        : [],
    }));

    await client.query("COMMIT");

    return {
      user_id: targetUserId,
      sessions,
      limit: safeLimit,
      offset: safeOffset,
      total: Number(totalResult.rows[0]?.total ?? 0),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    error.statusCode = error.statusCode || 500;
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getUserWalletBalanceForAdmin,
  getUserWalletTransactionsForAdmin,
  getUserWalletSessionGroupsForAdmin,
};
