const pool = require("../db");

const RANGE_DAYS = {
  "7d": 7,
  "30d": 30,
};

function normalizeRange(range) {
  return RANGE_DAYS[String(range || "").trim()] ? String(range).trim() : "30d";
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

function toDateKey(input, timeZone) {
  if (!input) return null;

  const value = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  return dateKeyFormatter(timeZone).format(value);
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

function createZeroSeries(labels) {
  return Object.fromEntries(labels.map((label) => [label, 0]));
}

function bucketCounts(rows, labels, timeZone, fieldName) {
  const counts = createZeroSeries(labels);

  for (const row of rows) {
    const key = toDateKey(row[fieldName], timeZone);
    if (key && key in counts) {
      counts[key] += 1;
    }
  }

  return labels.map((label) => counts[label] ?? 0);
}

function bucketSums(rows, labels, timeZone, fieldName, valueName) {
  const sums = createZeroSeries(labels);

  for (const row of rows) {
    const key = toDateKey(row[fieldName], timeZone);
    if (key && key in sums) {
      sums[key] += Number(row[valueName] || 0);
    }
  }

  return labels.map((label) => sums[label] ?? 0);
}

function toInt(value) {
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

function toNumber(value) {
  return Number(value ?? 0) || 0;
}

function normalizeMetadata(metadata) {
  if (!metadata) return {};

  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_) {
      return {};
    }
  }

  return typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

function buildAdjustmentRecord(row) {
  const metadata = normalizeMetadata(row.metadata);
  const isCredit = String(row.reference_kind || "") === "admin_credit";
  const actorId =
    metadata.credited_by_admin_id ??
    metadata.paid_by_admin_id ??
    null;
  const actorEmail =
    metadata.credited_by_admin_email ??
    metadata.paid_by_admin_email ??
    "";
  const actorRole =
    metadata.credited_by_admin_role ??
    metadata.paid_by_admin_role ??
    "";

  return {
    id: String(row.id || ""),
    created_at: row.created_at,
    direction: String(row.direction || ""),
    amount_credits: toInt(row.amount_credits),
    reference_kind: String(row.reference_kind || ""),
    title: isCredit
      ? String(metadata.credit_title || "Credits added")
      : "Payout made",
    note: isCredit
      ? String(metadata.credit_note || "")
      : String(metadata.payout_note || ""),
    actor: {
      id: actorId === null || actorId === undefined ? "" : String(actorId),
      email: String(actorEmail || ""),
      role: String(actorRole || ""),
    },
    target_user: {
      id: String(row.target_user_id || ""),
      email: String(row.target_user_email || ""),
      metadata: {
        first_name: String(row.target_first_name || ""),
        last_name: String(row.target_last_name || ""),
      },
    },
  };
}

async function fetchFinanceSummary({ range = "30d", timeZone = "UTC" }) {
  const safeRange = normalizeRange(range);
  const safeTimeZone = normalizeTimeZone(timeZone);
  const rangeDays = RANGE_DAYS[safeRange];
  const trendLabels = buildDateKeys(rangeDays, safeTimeZone);

  const [
    walletSnapshotResult,
    ordersSummaryResult,
    walletMovementResult,
    walletBreakdownResult,
    sessionSummaryResult,
    recentAdjustmentsResult,
    paidOrderTrendResult,
    walletTrendResult,
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          COALESCE(SUM(balance_credits), 0)::bigint AS outstanding_balance_credits,
          COUNT(*) FILTER (WHERE balance_credits > 0)::int AS users_with_positive_balance
        FROM wallet
      `,
    ),
    pool.query(
      `
        SELECT
          COALESCE(SUM(total_amount_paise) FILTER (
            WHERE status = 'completed'
              AND paid_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS paid_amount_paise,
          COUNT(*) FILTER (
            WHERE status = 'completed'
              AND paid_at >= NOW() - ($1::int * INTERVAL '1 day')
          )::int AS paid_orders_count,
          COALESCE(SUM(total_amount_paise) FILTER (
            WHERE status IN ('pending', 'processing', 'hold')
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS pending_amount_paise,
          COUNT(*) FILTER (
            WHERE status IN ('pending', 'processing', 'hold')
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          )::int AS pending_orders_count,
          COALESCE(SUM(total_amount_paise) FILTER (
            WHERE status IN ('cancelled', 'return')
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS cancelled_amount_paise,
          COUNT(*) FILTER (
            WHERE status IN ('cancelled', 'return')
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          )::int AS cancelled_orders_count,
          COALESCE(AVG(total_amount_paise) FILTER (
            WHERE status = 'completed'
              AND paid_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::numeric(14,2) AS average_paid_order_size_paise,
          COALESCE(SUM(credits_to_grant) FILTER (
            WHERE status = 'completed'
              AND paid_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS credits_sold_total,
          COALESCE(SUM(credits_to_grant) FILTER (
            WHERE status = 'completed'
              AND credits_granted = TRUE
              AND paid_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS credits_granted_total,
          COUNT(*) FILTER (
            WHERE status = 'completed'
              AND COALESCE(credits_granted, FALSE) = FALSE
              AND paid_at >= NOW() - ($1::int * INTERVAL '1 day')
          )::int AS paid_without_credit_grant_count
        FROM orders
      `,
      [rangeDays],
    ),
    pool.query(
      `
        SELECT
          COALESCE(SUM(amount_credits) FILTER (
            WHERE direction = 'credit'
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS credits_in_total,
          COALESCE(SUM(amount_credits) FILTER (
            WHERE direction = 'debit'
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS credits_out_total,
          COALESCE(SUM(amount_credits) FILTER (
            WHERE reference_kind = 'admin_credit'
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS admin_credits_total,
          COUNT(*) FILTER (
            WHERE reference_kind = 'admin_credit'
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          )::int AS admin_credits_count,
          COALESCE(SUM(amount_credits) FILTER (
            WHERE reference_kind = 'admin_payout'
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          ), 0)::bigint AS admin_payouts_total,
          COUNT(*) FILTER (
            WHERE reference_kind = 'admin_payout'
              AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          )::int AS admin_payouts_count
        FROM wallet_transactions
      `,
      [rangeDays],
    ),
    pool.query(
      `
        SELECT
          direction::text AS direction,
          CASE
            WHEN direction = 'credit' AND reference_kind = 'order' THEN 'topups'
            WHEN direction = 'credit' AND reference_kind = 'admin_credit' THEN 'admin_credits'
            WHEN direction = 'credit' AND reason = 'refund' THEN 'refunds'
            WHEN direction = 'credit' AND reference_kind = 'session' THEN 'session_earnings'
            WHEN direction = 'credit' AND reason = 'job_payout' THEN 'job_payouts'
            WHEN direction = 'debit' AND reference_kind = 'session' THEN 'session_spend'
            WHEN direction = 'debit' AND reference_kind = 'admin_payout' THEN 'admin_payouts'
            WHEN direction = 'debit' AND reason = 'job_post_fee' THEN 'job_post_fees'
            WHEN direction = 'debit' AND reason = 'job_escrow_hold' THEN 'job_escrow_holds'
            ELSE 'other'
          END AS bucket,
          COALESCE(SUM(amount_credits), 0)::bigint AS total_credits
        FROM wallet_transactions
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY direction::text, bucket
        ORDER BY direction::text ASC, bucket ASC
      `,
      [rangeDays],
    ),
    pool.query(
      `
        SELECT
          COUNT(DISTINCT NULLIF(split_part(reference_id, ':', 2), '')::bigint)::int AS billed_sessions_count,
          COALESCE(SUM(amount_credits), 0)::bigint AS total_session_credits_billed
        FROM wallet_transactions
        WHERE direction = 'debit'
          AND reference_kind = 'session'
          AND reference_id LIKE 'session:%'
          AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
      `,
      [rangeDays],
    ),
    pool.query(
      `
        SELECT
          wt.id,
          wt.created_at,
          wt.direction,
          wt.amount_credits,
          wt.reference_kind,
          wt.metadata,
          u.id AS target_user_id,
          u.email AS target_user_email,
          MAX(CASE WHEN um.key = 'first_name' THEN um.value END) AS target_first_name,
          MAX(CASE WHEN um.key = 'last_name' THEN um.value END) AS target_last_name
        FROM wallet_transactions wt
        JOIN users u ON u.id = wt.user_id
        LEFT JOIN user_metadata um
          ON um.user_id = u.id
         AND um.key IN ('first_name', 'last_name')
        WHERE wt.reference_kind IN ('admin_credit', 'admin_payout')
          AND wt.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY wt.id, wt.created_at, wt.direction, wt.amount_credits, wt.reference_kind, wt.metadata, u.id, u.email
        ORDER BY wt.created_at DESC, wt.id DESC
        LIMIT 10
      `,
      [rangeDays],
    ),
    pool.query(
      `
        SELECT paid_at, total_amount_paise
        FROM orders
        WHERE status = 'completed'
          AND paid_at IS NOT NULL
          AND paid_at >= NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY paid_at ASC
      `,
      [rangeDays],
    ),
    pool.query(
      `
        SELECT created_at, direction, reference_kind, amount_credits
        FROM wallet_transactions
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY created_at ASC
      `,
      [rangeDays],
    ),
  ]);

  const walletSnapshotRow = walletSnapshotResult.rows[0] || {};
  const ordersSummaryRow = ordersSummaryResult.rows[0] || {};
  const walletMovementRow = walletMovementResult.rows[0] || {};
  const sessionSummaryRow = sessionSummaryResult.rows[0] || {};

  const creditsAddedRows = walletTrendResult.rows.filter(
    (row) => String(row.direction || "") === "credit",
  );
  const creditsSpentRows = walletTrendResult.rows.filter(
    (row) => String(row.direction || "") === "debit",
  );
  const adminPayoutTrendRows = walletTrendResult.rows.filter(
    (row) =>
      String(row.direction || "") === "debit" &&
      String(row.reference_kind || "") === "admin_payout",
  );
  const sessionBilledTrendRows = walletTrendResult.rows.filter(
    (row) =>
      String(row.direction || "") === "debit" &&
      String(row.reference_kind || "") === "session",
  );

  const walletBreakdownMap = walletBreakdownResult.rows.reduce(
    (accumulator, row) => {
      const direction = String(row.direction || "");
      if (!accumulator[direction]) {
        accumulator[direction] = [];
      }

      accumulator[direction].push({
        key: String(row.bucket || "other"),
        label: String(row.bucket || "other")
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        amount_credits: toInt(row.total_credits),
      });

      return accumulator;
    },
    { credit: [], debit: [] },
  );

  const totalSessionCreditsBilled = toInt(sessionSummaryRow.total_session_credits_billed);
  const billedSessionsCount = toInt(sessionSummaryRow.billed_sessions_count);

  return {
    range: safeRange,
    time_zone: safeTimeZone,
    headline: {
      paid_amount_paise: toInt(ordersSummaryRow.paid_amount_paise),
      outstanding_balance_credits: toInt(walletSnapshotRow.outstanding_balance_credits),
      paid_orders_count: toInt(ordersSummaryRow.paid_orders_count),
      credits_spent_total: toInt(walletMovementRow.credits_out_total),
      admin_payouts_total: toInt(walletMovementRow.admin_payouts_total),
      admin_credits_total: toInt(walletMovementRow.admin_credits_total),
    },
    cash_orders: {
      paid_amount_paise: toInt(ordersSummaryRow.paid_amount_paise),
      paid_orders_count: toInt(ordersSummaryRow.paid_orders_count),
      pending_amount_paise: toInt(ordersSummaryRow.pending_amount_paise),
      pending_orders_count: toInt(ordersSummaryRow.pending_orders_count),
      cancelled_amount_paise: toInt(ordersSummaryRow.cancelled_amount_paise),
      cancelled_orders_count: toInt(ordersSummaryRow.cancelled_orders_count),
      average_paid_order_size_paise: toNumber(
        ordersSummaryRow.average_paid_order_size_paise,
      ),
      credits_sold_total: toInt(ordersSummaryRow.credits_sold_total),
      credits_granted_total: toInt(ordersSummaryRow.credits_granted_total),
      paid_without_credit_grant_count: toInt(
        ordersSummaryRow.paid_without_credit_grant_count,
      ),
    },
    wallet: {
      outstanding_balance_credits: toInt(
        walletSnapshotRow.outstanding_balance_credits,
      ),
      users_with_positive_balance: toInt(
        walletSnapshotRow.users_with_positive_balance,
      ),
      credits_in_total: toInt(walletMovementRow.credits_in_total),
      credits_out_total: toInt(walletMovementRow.credits_out_total),
      net_credit_movement:
        toInt(walletMovementRow.credits_in_total) -
        toInt(walletMovementRow.credits_out_total),
      credits_in_breakdown: walletBreakdownMap.credit,
      credits_out_breakdown: walletBreakdownMap.debit,
    },
    sessions: {
      billed_sessions_count: billedSessionsCount,
      total_session_credits_billed: totalSessionCreditsBilled,
      average_credits_per_billed_session:
        billedSessionsCount > 0
          ? Number((totalSessionCreditsBilled / billedSessionsCount).toFixed(2))
          : 0,
    },
    admin_adjustments: {
      admin_credits_count: toInt(walletMovementRow.admin_credits_count),
      admin_credits_total: toInt(walletMovementRow.admin_credits_total),
      admin_payouts_count: toInt(walletMovementRow.admin_payouts_count),
      admin_payouts_total: toInt(walletMovementRow.admin_payouts_total),
      recent_adjustments: recentAdjustmentsResult.rows.map(buildAdjustmentRecord),
    },
    trends: {
      labels: trendLabels,
      paid_amount_paise: bucketSums(
        paidOrderTrendResult.rows,
        trendLabels,
        safeTimeZone,
        "paid_at",
        "total_amount_paise",
      ),
      paid_orders_count: bucketCounts(
        paidOrderTrendResult.rows,
        trendLabels,
        safeTimeZone,
        "paid_at",
      ),
      credits_added: bucketSums(
        creditsAddedRows,
        trendLabels,
        safeTimeZone,
        "created_at",
        "amount_credits",
      ),
      credits_spent: bucketSums(
        creditsSpentRows,
        trendLabels,
        safeTimeZone,
        "created_at",
        "amount_credits",
      ),
      admin_payouts: bucketSums(
        adminPayoutTrendRows,
        trendLabels,
        safeTimeZone,
        "created_at",
        "amount_credits",
      ),
      session_credits_billed: bucketSums(
        sessionBilledTrendRows,
        trendLabels,
        safeTimeZone,
        "created_at",
        "amount_credits",
      ),
    },
  };
}

module.exports = {
  fetchFinanceSummary,
};
