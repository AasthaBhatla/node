const pool = require("../db");
const userServices = require("./userService");
const { creditWallet, debitWallet } = require("./walletService");

const assertPosInt = (value) => Number.isInteger(value) && value > 0;
const RANGE_DAYS = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

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

function normalizeRange(range) {
  const value = String(range || "").trim();
  if (value === "custom") {
    return "custom";
  }

  return RANGE_DAYS[value] ? value : "30d";
}

function normalizeTimeZone(timeZone) {
  const value = String(timeZone || "").trim();

  if (!value) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch (_) {
    return "UTC";
  }
}

function dateKeyFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function hourKeyFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
}

function normalizeDateInput(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toDateKey(input, timeZone) {
  if (!input) return null;

  const value = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  return dateKeyFormatter(timeZone).format(value);
}

function toHourKey(input, timeZone) {
  if (!input) return null;

  const value = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  const parts = hourKeyFormatter(timeZone).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  return `${year}-${month}-${day} ${hour}:00`;
}

function dateKeyToDate(key) {
  const [year, month, day] = String(key || "")
    .split("-")
    .map((value) => Number.parseInt(value, 10));

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDaysToDateKey(key, delta) {
  const date = dateKeyToDate(key);
  if (!date) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + delta);
  return dateKeyFormatter("UTC").format(date);
}

function buildDateKeys(days, timeZone) {
  const keys = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const cursor = new Date(Date.now() - index * 24 * 60 * 60 * 1000);
    const key = toDateKey(cursor, timeZone);
    if (key && keys[keys.length - 1] !== key) {
      keys.push(key);
    }
  }

  return keys;
}

function buildDateKeysFromBounds(dateFrom, dateTo) {
  const keys = [];
  let cursor = dateFrom;

  while (cursor && cursor <= dateTo) {
    keys.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }

  return keys;
}

function buildHourKeys(dateKey) {
  if (!normalizeDateInput(dateKey)) {
    return [];
  }

  const keys = [];
  for (let hour = 0; hour < 24; hour += 1) {
    keys.push(`${dateKey} ${String(hour).padStart(2, "0")}:00`);
  }

  return keys;
}

function resolveDateWindow({ range, timeZone, from, to }) {
  const safeRange = normalizeRange(range);

  if (safeRange === "custom") {
    const dateFrom = normalizeDateInput(from);
    const dateTo = normalizeDateInput(to);

    if (!dateFrom || !dateTo) {
      const error = new Error("Valid from and to dates are required for a custom range.");
      error.statusCode = 400;
      throw error;
    }

    if (dateFrom > dateTo) {
      const error = new Error("The custom from date cannot be after the to date.");
      error.statusCode = 400;
      throw error;
    }

    const trendGranularity = dateFrom === dateTo ? "hour" : "day";
    return {
      safeRange,
      dateFrom,
      dateTo,
      trendGranularity,
      trendLabels:
        trendGranularity === "hour"
          ? buildHourKeys(dateFrom)
          : buildDateKeysFromBounds(dateFrom, dateTo),
    };
  }

  const rangeDays = RANGE_DAYS[safeRange];
  const dateTo = toDateKey(new Date(), timeZone);
  const dateFrom = addDaysToDateKey(dateTo, -(rangeDays - 1));
  const trendGranularity = rangeDays === 1 ? "hour" : "day";

  return {
    safeRange,
    dateFrom,
    dateTo,
    trendGranularity,
    trendLabels:
      trendGranularity === "hour"
        ? buildHourKeys(dateFrom)
        : buildDateKeys(rangeDays, timeZone),
  };
}

function createZeroSeries(labels) {
  return Object.fromEntries(labels.map((label) => [label, 0]));
}

function bucketSums(rows, labels, timeZone, fieldName, valueName, granularity = "day") {
  const sums = createZeroSeries(labels);

  for (const row of rows) {
    const key =
      granularity === "hour"
        ? toHourKey(row[fieldName], timeZone)
        : toDateKey(row[fieldName], timeZone);
    if (key && key in sums) {
      sums[key] += Number(row[valueName] || 0);
    }
  }

  return labels.map((label) => sums[label] ?? 0);
}

function toInt(value) {
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

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

async function createUserWalletCreditForAdmin({
  userId,
  amountCredits,
  title,
  note,
  adminUser,
}) {
  const targetUserId = parseInt(userId, 10);
  const safeAmount = Number(amountCredits);
  const safeTitle = String(title || "").trim();
  const safeNote = String(note || "").trim();

  if (!assertPosInt(targetUserId)) {
    const error = new Error("Invalid user_id");
    error.statusCode = 400;
    throw error;
  }

  if (!assertPosInt(safeAmount)) {
    const error = new Error("amount_credits must be a positive integer");
    error.statusCode = 400;
    throw error;
  }

  if (!safeTitle) {
    const error = new Error("A title is required for this credit entry.");
    error.statusCode = 400;
    throw error;
  }

  const creditedAt = new Date().toISOString();
  const result = await creditWallet({
    userId: targetUserId,
    amount: safeAmount,
    reason: "adjustment",
    reference_kind: "admin_credit",
    reference_id: `admin-credit:${targetUserId}:${Date.now()}`,
    idempotency_key: `admin-credit:${targetUserId}:${Date.now()}:${adminUser?.id || "admin"}`,
    metadata: {
      credit_title: safeTitle,
      credit_note: safeNote,
      credited_at: creditedAt,
      credited_by_admin_id: adminUser?.id || null,
      credited_by_admin_email: adminUser?.email || null,
      credited_by_admin_role: adminUser?.role || null,
    },
  });

  return {
    user_id: targetUserId,
    amount_credits: safeAmount,
    title: safeTitle,
    note: safeNote,
    credited_at: creditedAt,
    credited_by_admin_id: adminUser?.id || null,
    credited_by_admin_email: adminUser?.email || null,
    credited_by_admin_role: adminUser?.role || null,
    balance_credits: Number(result.balance_credits ?? 0),
    message: result.message,
  };
}

async function createUserWalletPayoutForAdmin({
  userId,
  amountCredits,
  note,
  adminUser,
}) {
  const targetUserId = parseInt(userId, 10);
  const amount = parseInt(amountCredits, 10);
  const trimmedNote = String(note ?? "").trim();

  if (!assertPosInt(targetUserId)) {
    const error = new Error("Invalid user_id");
    error.statusCode = 400;
    throw error;
  }

  if (!assertPosInt(amount)) {
    const error = new Error("amount_credits must be a positive integer");
    error.statusCode = 400;
    throw error;
  }

  if (!trimmedNote) {
    const error = new Error("note is required");
    error.statusCode = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const idempotencyKey = `admin-payout:${targetUserId}:${Date.now()}:${adminUser?.id || "admin"}`;

  const result = await debitWallet({
    userId: targetUserId,
    amount,
    reason: "adjustment",
    reference_kind: "admin_payout",
    reference_id: idempotencyKey,
    idempotency_key: idempotencyKey,
    metadata: {
      payout_note: trimmedNote,
      paid_at: now,
      paid_by_admin_id:
        adminUser?.id === undefined || adminUser?.id === null
          ? null
          : Number(adminUser.id),
      paid_by_admin_email: adminUser?.email ? String(adminUser.email) : "",
      paid_by_admin_role: adminUser?.role ? String(adminUser.role) : "",
    },
  });

  return {
    user_id: targetUserId,
    amount_credits: amount,
    note: trimmedNote,
    paid_at: now,
    paid_by_admin_id:
      adminUser?.id === undefined || adminUser?.id === null
        ? null
        : Number(adminUser.id),
    paid_by_admin_email: adminUser?.email ? String(adminUser.email) : "",
    paid_by_admin_role: adminUser?.role ? String(adminUser.role) : "",
    balance_credits: Number(result.balance_credits ?? 0),
    message: result.message || "Payout recorded successfully",
  };
}

async function getUserWalletAnalyticsForAdmin({
  userId,
  range = "30d",
  timeZone = "UTC",
  from,
  to,
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const targetUserId = await ensureWalletRow(client, userId);
    const safeTimeZone = normalizeTimeZone(timeZone);
    const { safeRange, dateFrom, dateTo, trendGranularity, trendLabels } =
      resolveDateWindow({
        range,
        timeZone: safeTimeZone,
        from,
        to,
      });

    const [summaryResult, breakdownResult, trendResult] = await Promise.all([
      client.query(
        `
          SELECT
            COALESCE(SUM(amount_credits) FILTER (
              WHERE direction = 'credit'
                AND reference_kind = 'order'
                AND created_at >= $2::date
                AND created_at < ($3::date + INTERVAL '1 day')
            ), 0)::bigint AS topups_total,
            COALESCE(SUM(amount_credits) FILTER (
              WHERE direction = 'debit'
                AND reference_kind IS DISTINCT FROM 'admin_payout'
                AND created_at >= $2::date
                AND created_at < ($3::date + INTERVAL '1 day')
            ), 0)::bigint AS credits_spent_total,
            COALESCE(SUM(amount_credits) FILTER (
              WHERE direction = 'credit'
                AND reason = 'refund'
                AND created_at >= $2::date
                AND created_at < ($3::date + INTERVAL '1 day')
            ), 0)::bigint AS refunds_total,
            COALESCE(SUM(amount_credits) FILTER (
              WHERE direction = 'credit'
                AND reference_kind = 'admin_credit'
                AND created_at >= $2::date
                AND created_at < ($3::date + INTERVAL '1 day')
            ), 0)::bigint AS manual_credits_total
          FROM wallet_transactions
          WHERE user_id = $1
        `,
        [targetUserId, dateFrom, dateTo],
      ),
      client.query(
        `
          SELECT
            CASE
              WHEN reference_kind = 'session' THEN 'session_spend'
              WHEN reason = 'job_post_fee' THEN 'job_post_fee'
              WHEN reason = 'job_escrow_hold' THEN 'job_escrow_hold'
              WHEN reference_kind = 'admin_payout' THEN 'admin_payout'
              ELSE 'other'
            END AS bucket,
            COUNT(*)::int AS transaction_count,
            COALESCE(SUM(amount_credits), 0)::bigint AS total_credits
          FROM wallet_transactions
          WHERE user_id = $1
            AND direction = 'debit'
            AND created_at >= $2::date
            AND created_at < ($3::date + INTERVAL '1 day')
          GROUP BY bucket
          ORDER BY total_credits DESC, bucket ASC
        `,
        [targetUserId, dateFrom, dateTo],
      ),
      client.query(
        `
          SELECT created_at, direction, reason, reference_kind, amount_credits
          FROM wallet_transactions
          WHERE user_id = $1
            AND created_at >= $2::date
            AND created_at < ($3::date + INTERVAL '1 day')
          ORDER BY created_at ASC
        `,
        [targetUserId, dateFrom, dateTo],
      ),
    ]);

    await client.query("COMMIT");

    const summaryRow = summaryResult.rows[0] || {};
    const trendRows = trendResult.rows || [];
    const topupRows = trendRows.filter(
      (row) =>
        String(row.direction || "") === "credit" &&
        String(row.reference_kind || "") === "order",
    );
    const creditSpendRows = trendRows.filter(
      (row) =>
        String(row.direction || "") === "debit" &&
        String(row.reference_kind || "") !== "admin_payout",
    );
    const refundRows = trendRows.filter(
      (row) =>
        String(row.direction || "") === "credit" &&
        String(row.reason || "") === "refund",
    );
    const manualCreditRows = trendRows.filter(
      (row) =>
        String(row.direction || "") === "credit" &&
        String(row.reference_kind || "") === "admin_credit",
    );

    const spendLabelMap = {
      session_spend: "Session charges",
      job_post_fee: "Job post fees",
      job_escrow_hold: "Job escrow holds",
      admin_payout: "Admin payouts",
      other: "Other debits",
    };

    return {
      user_id: targetUserId,
      range: safeRange,
      time_zone: safeTimeZone,
      date_from: dateFrom,
      date_to: dateTo,
      headline: {
        topups_total: toInt(summaryRow.topups_total),
        credits_spent_total: toInt(summaryRow.credits_spent_total),
        refunds_total: toInt(summaryRow.refunds_total),
        manual_credits_total: toInt(summaryRow.manual_credits_total),
      },
      spend_breakdown: (breakdownResult.rows || []).map((row) => ({
        key: String(row.bucket || "other"),
        label:
          spendLabelMap[String(row.bucket || "other")] ||
          String(row.bucket || "other"),
        total_credits: toInt(row.total_credits),
        transaction_count: toInt(row.transaction_count),
      })),
      trends: {
        granularity: trendGranularity,
        labels: trendLabels,
        topups: bucketSums(
          topupRows,
          trendLabels,
          safeTimeZone,
          "created_at",
          "amount_credits",
          trendGranularity,
        ),
        credits_spent: bucketSums(
          creditSpendRows,
          trendLabels,
          safeTimeZone,
          "created_at",
          "amount_credits",
          trendGranularity,
        ),
        refunds: bucketSums(
          refundRows,
          trendLabels,
          safeTimeZone,
          "created_at",
          "amount_credits",
          trendGranularity,
        ),
        manual_credits: bucketSums(
          manualCreditRows,
          trendLabels,
          safeTimeZone,
          "created_at",
          "amount_credits",
          trendGranularity,
        ),
      },
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
  createUserWalletCreditForAdmin,
  createUserWalletPayoutForAdmin,
  getUserWalletAnalyticsForAdmin,
  getUserWalletBalanceForAdmin,
  getUserWalletTransactionsForAdmin,
  getUserWalletSessionGroupsForAdmin,
};
