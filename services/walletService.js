// services/walletService.js
const pool = require("../db");
const userServices = require("./userService");
const assertPosInt = (v) => Number.isInteger(v) && v > 0;

const ensureWalletRow = async (client, userId) => {
  // Ensure user exists
  const u = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!u.rows[0]) {
    const e = new Error("User not found");
    e.statusCode = 404;
    throw e;
  }

  // Ensure wallet row exists
  await client.query(
    `INSERT INTO wallet (user_id, balance_credits)
     VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
};

const getWalletBalance = async (userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await ensureWalletRow(client, userId);

    const r = await client.query(
      `SELECT balance_credits
       FROM wallet
       WHERE user_id = $1`,
      [userId],
    );

    await client.query("COMMIT");
    return r.rows[0]?.balance_credits ?? 0;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
};

const debitWallet = async ({
  userId,
  amount,
  reason,
  reference_kind,
  reference_id,
  idempotency_key, // recommended
  metadata, // optional
}) => {
  if (!assertPosInt(amount)) {
    const e = new Error("amount must be a positive integer");
    e.statusCode = 400;
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await ensureWalletRow(client, userId);

    // Lock wallet row for safe concurrent debits
    const wRes = await client.query(
      `SELECT user_id, balance_credits
       FROM wallet
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    const wallet = wRes.rows[0];

    if (!wallet) {
      const e = new Error("Wallet not found");
      e.statusCode = 404;
      throw e;
    }

    if (wallet.balance_credits < amount) {
      const e = new Error("Insufficient wallet balance");
      e.statusCode = 400;
      throw e;
    }

    // Insert DEBIT transaction (idempotent if idempotency_key provided)
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
          reason || "session",
          reference_kind || null,
          reference_id || null,
          idempotency_key,
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
          reason || "session",
          reference_kind || null,
          reference_id || null,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
      inserted = ins.rowCount === 1;
    }

    if (inserted) {
      await client.query(
        `UPDATE wallet
         SET balance_credits = balance_credits - $1,
             updated_at = NOW()
         WHERE user_id = $2`,
        [amount, userId],
      );
    }

    const finalRes = await client.query(
      `SELECT balance_credits FROM wallet WHERE user_id = $1`,
      [userId],
    );

    await client.query("COMMIT");

    return {
      message: inserted
        ? "Debited successfully"
        : "Debit already applied (idempotent)",
      balance_credits: finalRes.rows[0]?.balance_credits ?? 0,
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
};

const creditWallet = async ({
  userId,
  amount,
  reason,
  reference_kind,
  reference_id,
  idempotency_key, // recommended
  metadata, // optional
}) => {
  if (!assertPosInt(amount)) {
    const e = new Error("amount must be a positive integer");
    e.statusCode = 400;
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await ensureWalletRow(client, userId);

    // Lock wallet row for safe concurrent credits
    const wRes = await client.query(
      `SELECT user_id, balance_credits
       FROM wallet
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    const wallet = wRes.rows[0];

    if (!wallet) {
      const e = new Error("Wallet not found");
      e.statusCode = 404;
      throw e;
    }

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
          reason || "topup",
          reference_kind || null,
          reference_id || null,
          idempotency_key,
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
          reason || "topup",
          reference_kind || null,
          reference_id || null,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
      inserted = ins.rowCount === 1;
    }

    if (inserted) {
      await client.query(
        `UPDATE wallet
         SET balance_credits = balance_credits + $1,
             updated_at = NOW()
         WHERE user_id = $2`,
        [amount, userId],
      );
    }

    const finalRes = await client.query(
      `SELECT balance_credits FROM wallet WHERE user_id = $1`,
      [userId],
    );

    await client.query("COMMIT");

    return {
      message: inserted
        ? "Credited successfully"
        : "Credit already applied (idempotent)",
      balance_credits: finalRes.rows[0]?.balance_credits ?? 0,
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
};

const getWalletTransactions = async ({ userId, limit = 50, offset = 0 }) => {
  const safeLimit =
    Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await ensureWalletRow(client, userId);

    const r = await client.query(
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
      [userId, safeLimit, safeOffset],
    );

    await client.query("COMMIT");
    return { transactions: r.rows, limit: safeLimit, offset: safeOffset };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Enriched wallet transactions:
 * - Adds counterparty user (partner/client) for session-linked rows
 * - Includes role + ALL metadata keys + taxonomies (via getUsersByIds)
 */
async function getWalletTransactionsEnriched({
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
    await ensureWalletRow(client, userId);

    // 1) Get ledger rows
    const r = await client.query(
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
      [userId, safeLimit, safeOffset],
    );

    const txs = r.rows || [];

    // inside getWalletTransactionsEnriched(), after you have: const txs = r.rows || [];

    const extractCounterpartyIdFromTx = (tx, myUserId) => {
      const meta = tx.metadata || {};

      // metadata might come as JSON string sometimes; normalize
      let m = meta;
      if (typeof meta === "string") {
        try {
          m = JSON.parse(meta);
        } catch {
          m = {};
        }
      }

      const partnerId = Number(m.partner_id);
      if (Number.isFinite(partnerId) && partnerId !== Number(myUserId))
        return partnerId;

      const clientId = Number(m.client_id);
      if (Number.isFinite(clientId) && clientId !== Number(myUserId))
        return clientId;

      // optional fallback: parse session:1:m:1:debit => session id = 1
      const ref = String(tx.reference_id || "");
      if (ref.startsWith("session:")) {
        const parts = ref.split(":");
        const sid = Number(parts[1]);
        // you can use sid to fetch sessions and derive counterparty,
        // but only if you really need it.
      }

      return null;
    };

    // 1) collect counterparty ids from metadata
    const txToCounterpartyId = {};
    const counterpartyIds = [];

    for (const t of txs) {
      const cpId = extractCounterpartyIdFromTx(t, userId);
      if (!cpId) continue;
      txToCounterpartyId[t.id] = cpId;
      counterpartyIds.push(cpId);
    }

    const uniqueCounterpartyIds = Array.from(new Set(counterpartyIds));

    // 2) bulk fetch users (role + ALL metadata keys + taxonomies)
    let counterpartyMap = {};
    if (uniqueCounterpartyIds.length) {
      const users = await userServices.getUsersByIds(uniqueCounterpartyIds);
      counterpartyMap = {};
      for (const u of users || []) counterpartyMap[u.id] = u;
    }

    // 3) attach
    const enriched = txs.map((t) => {
      const cpId = txToCounterpartyId[t.id];
      return {
        ...t,
        counterparty: cpId ? counterpartyMap[cpId] || null : null,
      };
    });

    await client.query("COMMIT");
    return { transactions: enriched, limit: safeLimit, offset: safeOffset };
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

// ✅ Export everything explicitly (prevents the “is not a function” issue)
module.exports = {
  getWalletBalance,
  debitWallet,
  creditWallet,
  getWalletTransactions,
  getWalletTransactionsEnriched,
};
