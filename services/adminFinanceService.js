const pool = require("../db");

const PARTNER_PAYOUT_ROLES = ["lawyer", "officer"];

const RANGE_DAYS = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
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

function buildHourKeys(dateKey, timeZone) {
  if (!normalizeDateInput(dateKey)) {
    return [];
  }

  const keys = [];
  for (let hour = 0; hour < 24; hour += 1) {
    keys.push(`${dateKey} ${String(hour).padStart(2, "0")}:00`);
  }

  return keys;
}

function normalizeDateInput(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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

function buildDateKeysFromBounds(dateFrom, dateTo) {
  const keys = [];
  let cursor = dateFrom;

  while (cursor && cursor <= dateTo) {
    keys.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
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

    const isSingleDay = dateFrom === dateTo;
    const trendGranularity = isSingleDay ? "hour" : "day";
    const trendLabels = isSingleDay
      ? buildHourKeys(dateFrom, timeZone)
      : buildDateKeysFromBounds(dateFrom, dateTo);
    return {
      safeRange,
      dateFrom,
      dateTo,
      trendGranularity,
      trendLabels,
    };
  }

  const rangeDays = RANGE_DAYS[safeRange];
  const dateTo = toDateKey(new Date(), timeZone);
  const dateFrom = addDaysToDateKey(dateTo, -(rangeDays - 1));
  const trendGranularity = rangeDays === 1 ? "hour" : "day";
  const trendLabels =
    trendGranularity === "hour"
      ? buildHourKeys(dateFrom, timeZone)
      : buildDateKeys(rangeDays, timeZone);

  return {
    safeRange,
    dateFrom,
    dateTo,
    trendGranularity,
    trendLabels,
  };
}

function createZeroSeries(labels) {
  return Object.fromEntries(labels.map((label) => [label, 0]));
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

function bucketCounts(rows, labels, timeZone, fieldName, granularity = "day") {
  const counts = createZeroSeries(labels);

  for (const row of rows) {
    const key =
      granularity === "hour"
        ? toHourKey(row[fieldName], timeZone)
        : toDateKey(row[fieldName], timeZone);
    if (key && key in counts) {
      counts[key] += 1;
    }
  }

  return labels.map((label) => counts[label] ?? 0);
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

function buildPartnerPayoutUser(row) {
  return {
    id: String(row.id || ""),
    email: String(row.email || ""),
    role: String(row.role || ""),
    status: String(row.status || ""),
    balance_credits: toInt(row.balance_credits),
    metadata: {
      first_name: String(row.first_name || ""),
      last_name: String(row.last_name || ""),
      profile_pic_url: String(row.profile_pic_url || ""),
    },
  };
}

function buildPartnerPayoutGroups(rows) {
  const partnerPayoutGroups = PARTNER_PAYOUT_ROLES.map((role) => ({
    role,
    partner_count: 0,
    total_balance_credits: 0,
    users: [],
  }));
  const partnerPayoutMap = partnerPayoutGroups.reduce((accumulator, group) => {
    accumulator[group.role] = group;
    return accumulator;
  }, {});

  for (const row of rows) {
    const role = String(row.role || "").toLowerCase();
    if (!partnerPayoutMap[role]) {
      continue;
    }

    const balanceCredits = toInt(row.balance_credits);
    partnerPayoutMap[role].users.push(buildPartnerPayoutUser(row));
    partnerPayoutMap[role].partner_count += 1;
    partnerPayoutMap[role].total_balance_credits += balanceCredits;
  }

  return partnerPayoutGroups;
}

async function fetchPartnerPayoutSummary() {
  const result = await pool.query(
    `
      SELECT
        u.id,
        u.email,
        LOWER(COALESCE(u.role, '')) AS role,
        LOWER(COALESCE(u.status::text, '')) AS status,
        w.balance_credits,
        MAX(CASE WHEN um.key = 'first_name' THEN um.value END) AS first_name,
        MAX(CASE WHEN um.key = 'last_name' THEN um.value END) AS last_name,
        MAX(CASE WHEN um.key = 'profile_pic_url' THEN um.value END) AS profile_pic_url
      FROM wallet w
      JOIN users u ON u.id = w.user_id
      LEFT JOIN user_metadata um
        ON um.user_id = u.id
       AND um.key IN ('first_name', 'last_name', 'profile_pic_url')
      WHERE LOWER(COALESCE(u.role, '')) = ANY($1::text[])
        AND w.balance_credits > 0
      GROUP BY u.id, u.email, u.role, u.status, w.balance_credits
      ORDER BY LOWER(COALESCE(u.role, '')) ASC, w.balance_credits DESC, u.id DESC
    `,
    [PARTNER_PAYOUT_ROLES],
  );

  const groups = buildPartnerPayoutGroups(result.rows);
  const totalPayableCredits = groups.reduce(
    (total, group) => total + toInt(group.total_balance_credits),
    0,
  );
  const totalPartners = groups.reduce(
    (total, group) => total + toInt(group.partner_count),
    0,
  );

  return {
    generated_at: new Date().toISOString(),
    total_payable_credits: totalPayableCredits,
    total_partners: totalPartners,
    groups,
  };
}

async function fetchFinanceSummary({ range = "30d", timeZone = "UTC", from, to }) {
  const safeTimeZone = normalizeTimeZone(timeZone);
  const { safeRange, dateFrom, dateTo, trendGranularity, trendLabels } = resolveDateWindow({
    range,
    timeZone: safeTimeZone,
    from,
    to,
  });

  const [
    walletSnapshotResult,
    ordersSummaryResult,
    platformSummaryResult,
    partnerPayoutsResult,
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
              AND paid_at >= $1::date
              AND paid_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS paid_amount_paise,
          COUNT(*) FILTER (
            WHERE status = 'completed'
              AND paid_at >= $1::date
              AND paid_at < ($2::date + INTERVAL '1 day')
          )::int AS paid_orders_count,
          COALESCE(SUM(total_amount_paise) FILTER (
            WHERE status IN ('pending', 'processing', 'hold')
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS pending_amount_paise,
          COUNT(*) FILTER (
            WHERE status IN ('pending', 'processing', 'hold')
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          )::int AS pending_orders_count,
          COALESCE(SUM(total_amount_paise) FILTER (
            WHERE status IN ('cancelled', 'return')
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS cancelled_amount_paise,
          COUNT(*) FILTER (
            WHERE status IN ('cancelled', 'return')
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          )::int AS cancelled_orders_count,
          COALESCE(AVG(total_amount_paise) FILTER (
            WHERE status = 'completed'
              AND paid_at >= $1::date
              AND paid_at < ($2::date + INTERVAL '1 day')
          ), 0)::numeric(14,2) AS average_paid_order_size_paise,
          COALESCE(SUM(credits_to_grant) FILTER (
            WHERE status = 'completed'
              AND paid_at >= $1::date
              AND paid_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS credits_sold_total,
          COALESCE(SUM(credits_to_grant) FILTER (
            WHERE status = 'completed'
              AND credits_granted = TRUE
              AND paid_at >= $1::date
              AND paid_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS credits_granted_total,
          COUNT(*) FILTER (
            WHERE status = 'completed'
              AND COALESCE(credits_granted, FALSE) = FALSE
              AND paid_at >= $1::date
              AND paid_at < ($2::date + INTERVAL '1 day')
          )::int AS paid_without_credit_grant_count
        FROM orders
      `,
      [dateFrom, dateTo],
    ),
    pool.query(
      `
        SELECT
          COALESCE((SELECT balance_credits FROM platform_wallet WHERE id = 1), 0)::bigint AS platform_balance_credits,
          COALESCE(SUM(amount_credits) FILTER (
            WHERE created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS platform_earnings_credits
        FROM job_posting_fees
      `,
      [dateFrom, dateTo],
    ),
    pool.query(
      `
        SELECT
          u.id,
          u.email,
          LOWER(COALESCE(u.role, '')) AS role,
          LOWER(COALESCE(u.status::text, '')) AS status,
          w.balance_credits,
          MAX(CASE WHEN um.key = 'first_name' THEN um.value END) AS first_name,
          MAX(CASE WHEN um.key = 'last_name' THEN um.value END) AS last_name,
          MAX(CASE WHEN um.key = 'profile_pic_url' THEN um.value END) AS profile_pic_url
        FROM wallet w
        JOIN users u ON u.id = w.user_id
        LEFT JOIN user_metadata um
          ON um.user_id = u.id
         AND um.key IN ('first_name', 'last_name', 'profile_pic_url')
        WHERE LOWER(COALESCE(u.role, '')) = ANY($1::text[])
          AND w.balance_credits > 0
        GROUP BY u.id, u.email, u.role, u.status, w.balance_credits
        ORDER BY LOWER(COALESCE(u.role, '')) ASC, w.balance_credits DESC, u.id DESC
      `,
      [PARTNER_PAYOUT_ROLES],
    ),
    pool.query(
      `
        SELECT
          COALESCE(SUM(amount_credits) FILTER (
            WHERE direction = 'credit'
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS credits_in_total,
          COALESCE(SUM(amount_credits) FILTER (
            WHERE direction = 'debit'
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS credits_out_total,
          COALESCE(SUM(amount_credits) FILTER (
            WHERE direction = 'debit'
              AND reference_kind IS DISTINCT FROM 'admin_payout'
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS credits_spent_total,
          COALESCE(SUM(amount_credits) FILTER (
            WHERE reference_kind = 'admin_credit'
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS admin_credits_total,
          COUNT(*) FILTER (
            WHERE reference_kind = 'admin_credit'
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          )::int AS admin_credits_count,
          COALESCE(SUM(amount_credits) FILTER (
            WHERE reference_kind = 'admin_payout'
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          ), 0)::bigint AS admin_payouts_total,
          COUNT(*) FILTER (
            WHERE reference_kind = 'admin_payout'
              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')
          )::int AS admin_payouts_count
        FROM wallet_transactions
      `,
      [dateFrom, dateTo],
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
        WHERE created_at >= $1::date
          AND created_at < ($2::date + INTERVAL '1 day')
        GROUP BY direction::text, bucket
        ORDER BY direction::text ASC, bucket ASC
      `,
      [dateFrom, dateTo],
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
          AND created_at >= $1::date
          AND created_at < ($2::date + INTERVAL '1 day')
      `,
      [dateFrom, dateTo],
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
          AND wt.created_at >= $1::date
          AND wt.created_at < ($2::date + INTERVAL '1 day')
        GROUP BY wt.id, wt.created_at, wt.direction, wt.amount_credits, wt.reference_kind, wt.metadata, u.id, u.email
        ORDER BY wt.created_at DESC, wt.id DESC
        LIMIT 10
      `,
      [dateFrom, dateTo],
    ),
    pool.query(
      `
        SELECT paid_at, total_amount_paise
        FROM orders
        WHERE status = 'completed'
          AND paid_at IS NOT NULL
          AND paid_at >= $1::date
          AND paid_at < ($2::date + INTERVAL '1 day')
        ORDER BY paid_at ASC
      `,
      [dateFrom, dateTo],
    ),
    pool.query(
      `
        SELECT created_at, direction, reference_kind, amount_credits
        FROM wallet_transactions
        WHERE created_at >= $1::date
          AND created_at < ($2::date + INTERVAL '1 day')
        ORDER BY created_at ASC
      `,
      [dateFrom, dateTo],
    ),
  ]);

  const walletSnapshotRow = walletSnapshotResult.rows[0] || {};
  const ordersSummaryRow = ordersSummaryResult.rows[0] || {};
  const platformSummaryRow = platformSummaryResult.rows[0] || {};
  const walletMovementRow = walletMovementResult.rows[0] || {};
  const sessionSummaryRow = sessionSummaryResult.rows[0] || {};
  const partnerPayoutGroups = buildPartnerPayoutGroups(partnerPayoutsResult.rows);

  const creditsAddedRows = walletTrendResult.rows.filter(
    (row) => String(row.direction || "") === "credit",
  );
  const creditsSpentRows = walletTrendResult.rows.filter(
    (row) =>
      String(row.direction || "") === "debit" &&
      String(row.reference_kind || "") !== "admin_payout",
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
    date_from: dateFrom,
    date_to: dateTo,
    headline: {
      paid_amount_paise: toInt(ordersSummaryRow.paid_amount_paise),
      outstanding_balance_credits: toInt(walletSnapshotRow.outstanding_balance_credits),
      paid_orders_count: toInt(ordersSummaryRow.paid_orders_count),
      credits_spent_total: toInt(walletMovementRow.credits_spent_total),
      admin_payouts_total: toInt(walletMovementRow.admin_payouts_total),
      admin_credits_total: toInt(platformSummaryRow.platform_earnings_credits),
      platform_balance_credits: toInt(platformSummaryRow.platform_balance_credits),
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
    partner_payouts: partnerPayoutGroups,
    admin_adjustments: {
      admin_credits_count: toInt(walletMovementRow.admin_credits_count),
      admin_credits_total: toInt(walletMovementRow.admin_credits_total),
      admin_payouts_count: toInt(walletMovementRow.admin_payouts_count),
      admin_payouts_total: toInt(walletMovementRow.admin_payouts_total),
      recent_adjustments: recentAdjustmentsResult.rows.map(buildAdjustmentRecord),
    },
    trends: {
      granularity: trendGranularity,
      labels: trendLabels,
      paid_amount_paise: bucketSums(
        paidOrderTrendResult.rows,
        trendLabels,
        safeTimeZone,
        "paid_at",
        "total_amount_paise",
        trendGranularity,
      ),
      paid_orders_count: bucketCounts(
        paidOrderTrendResult.rows,
        trendLabels,
        safeTimeZone,
        "paid_at",
        trendGranularity,
      ),
      credits_added: bucketSums(
        creditsAddedRows,
        trendLabels,
        safeTimeZone,
        "created_at",
        "amount_credits",
        trendGranularity,
      ),
      credits_spent: bucketSums(
        creditsSpentRows,
        trendLabels,
        safeTimeZone,
        "created_at",
        "amount_credits",
        trendGranularity,
      ),
      admin_payouts: bucketSums(
        adminPayoutTrendRows,
        trendLabels,
        safeTimeZone,
        "created_at",
        "amount_credits",
        trendGranularity,
      ),
      session_credits_billed: bucketSums(
        sessionBilledTrendRows,
        trendLabels,
        safeTimeZone,
        "created_at",
        "amount_credits",
        trendGranularity,
      ),
    },
  };
}

module.exports = {
  fetchFinanceSummary,
  fetchPartnerPayoutSummary,
};
