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

module.exports = {
  getUserWalletBalanceForAdmin,
  getUserWalletTransactionsForAdmin,
};
