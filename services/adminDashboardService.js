const pool = require("../db");
const { getUnreadCount } = require("./notificationStoreService");
const { getQueueOverview } = require("./expertConnectService");

const APPROVABLE_ROLES = ["lawyer", "officer", "ngo"];
const RANGE_DAYS = {
  "7d": 7,
  "30d": 30,
};

function normalizeRange(range) {
  return RANGE_DAYS[String(range || "").trim()] ? String(range).trim() : "7d";
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

function bucketTimestamps(timestamps, labels, timeZone) {
  const counts = createZeroSeries(labels);

  for (const timestamp of timestamps) {
    const key = toDateKey(timestamp, timeZone);
    if (key && key in counts) {
      counts[key] += 1;
    }
  }

  return labels.map((label) => counts[label] ?? 0);
}

function toInt(value) {
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

function toNumber(value) {
  return Number(value ?? 0) || 0;
}

function sumSeries(values = []) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function formatPendingApprovalUser(row) {
  return {
    id: String(row.id),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    role: String(row.role || ""),
    status: String(row.status || ""),
    created_at: row.created_at,
    metadata: {
      first_name: row.first_name || "",
      last_name: row.last_name || "",
      profile_pic_url: row.profile_pic_url || "",
    },
  };
}

async function fetchPendingApprovalGroups() {
  const result = await pool.query(
    `
      SELECT *
      FROM (
        SELECT
          u.id,
          u.email,
          u.phone,
          u.role,
          u.status,
          u.created_at,
          MAX(CASE WHEN um.key = 'first_name' THEN um.value END) AS first_name,
          MAX(CASE WHEN um.key = 'last_name' THEN um.value END) AS last_name,
          MAX(CASE WHEN um.key = 'profile_pic_url' THEN um.value END) AS profile_pic_url,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(COALESCE(u.role, ''))
            ORDER BY u.created_at DESC, u.id DESC
          ) AS row_number
        FROM users u
        LEFT JOIN user_metadata um
          ON um.user_id = u.id
         AND um.key IN ('first_name', 'last_name', 'profile_pic_url')
        WHERE LOWER(COALESCE(u.role, '')) = ANY($1::text[])
          AND LOWER(COALESCE(u.status::text, '')) = 'registered'
        GROUP BY u.id, u.email, u.phone, u.role, u.status, u.created_at
      ) ranked
      WHERE row_number <= 5
      ORDER BY LOWER(COALESCE(role, '')), created_at DESC, id DESC
    `,
    [APPROVABLE_ROLES],
  );

  const groups = APPROVABLE_ROLES.map((role) => ({
    role,
    total: 0,
    users: [],
  }));

  const groupMap = groups.reduce((accumulator, group) => {
    accumulator[group.role] = group;
    return accumulator;
  }, {});

  for (const row of result.rows) {
    const role = String(row.role || "").toLowerCase();
    if (!groupMap[role]) {
      continue;
    }

    groupMap[role].users.push(formatPendingApprovalUser(row));
  }

  return groups;
}

async function fetchDashboardSummary({ adminUserId, range = "7d", timeZone = "UTC" }) {
  const safeRange = normalizeRange(range);
  const safeTimeZone = normalizeTimeZone(timeZone);
  const rangeDays = RANGE_DAYS[safeRange];
  const lookbackDays = Math.max(rangeDays + 7, 40);
  const trendLabels = buildDateKeys(rangeDays, safeTimeZone);

  const [
    userTotalsResult,
    roleCountsResult,
    approvableStatusResult,
    pendingGroups,
    recentUsersResult,
    reviewSummaryResult,
    latestReviewsResult,
    recentReviewsResult,
    recentApprovalEventsResult,
    streamCountsResult,
    taxonomyTotalResult,
    recentPostEventsResult,
    expertOverview,
    recentExpertRequestsResult,
    unreadCount,
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(role, '')) = ANY($1::text[])
              AND LOWER(COALESCE(status::text, '')) = 'registered'
          )::int AS pending_approvals_total
        FROM users
      `,
      [APPROVABLE_ROLES],
    ),
    pool.query(
      `
        SELECT
          LOWER(COALESCE(role, 'unknown')) AS role,
          COUNT(*)::int AS total
        FROM users
        GROUP BY 1
        ORDER BY total DESC, role ASC
      `,
    ),
    pool.query(
      `
        SELECT
          LOWER(COALESCE(role, '')) AS role,
          LOWER(COALESCE(status::text, '')) AS status,
          COUNT(*)::int AS total
        FROM users
        WHERE LOWER(COALESCE(role, '')) = ANY($1::text[])
          AND LOWER(COALESCE(status::text, '')) = ANY($2::text[])
        GROUP BY 1, 2
      `,
      [APPROVABLE_ROLES, ["registered", "verified", "blocked"]],
    ),
    fetchPendingApprovalGroups(),
    pool.query(
      `
        SELECT created_at
        FROM users
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
      `,
      [lookbackDays],
    ),
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_reviews,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_reviews,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_reviews,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_reviews,
          COALESCE(AVG(ratings), 0)::numeric(10,2) AS average_rating
        FROM reviews
      `,
    ),
    pool.query(
      `
        SELECT id, reviewer_id, type, type_id, review, ratings, status, created_at
        FROM reviews
        ORDER BY created_at DESC, id DESC
        LIMIT 5
      `,
    ),
    pool.query(
      `
        SELECT created_at
        FROM reviews
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
      `,
      [lookbackDays],
    ),
    pool.query(
      `
        SELECT
          u.id,
          LOWER(COALESCE(u.role, '')) AS role,
          LOWER(COALESCE(u.status::text, '')) AS status,
          um.value AS reviewed_at
        FROM user_metadata um
        JOIN users u ON u.id = um.user_id
        WHERE um.key = 'verification_reviewed_at'
          AND LOWER(COALESCE(u.role, '')) = ANY($1::text[])
      `,
      [APPROVABLE_ROLES],
    ),
    pool.query(
      `
        SELECT
          p.post_type,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE p.created_at >= NOW() - ($1::int * INTERVAL '1 day')
          )::int AS created_in_range
        FROM posts p
        GROUP BY p.post_type
        ORDER BY total DESC, p.post_type ASC
      `,
      [rangeDays],
    ),
    pool.query(`SELECT COUNT(*)::int AS total_taxonomies FROM taxonomy`),
    pool.query(
      `
        SELECT post_type, created_at
        FROM posts
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND post_type = ANY($2::text[])
      `,
      [lookbackDays, ["seek-help", "apply-as-volunteer"]],
    ),
    getQueueOverview(),
    pool.query(
      `
        SELECT created_at
        FROM expert_connection_queue
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
      `,
      [lookbackDays],
    ),
    getUnreadCount(adminUserId),
  ]);

  const userTotalsRow = userTotalsResult.rows[0] || {};
  const reviewSummaryRow = reviewSummaryResult.rows[0] || {};
  const taxonomyTotalRow = taxonomyTotalResult.rows[0] || {};

  const countsByRole = {};
  for (const row of roleCountsResult.rows) {
    countsByRole[String(row.role || "unknown")] = toInt(row.total);
  }

  const approvableCountsByStatus = Object.fromEntries(
    APPROVABLE_ROLES.map((role) => [
      role,
      {
        registered: 0,
        verified: 0,
        blocked: 0,
      },
    ]),
  );

  for (const row of approvableStatusResult.rows) {
    const role = String(row.role || "");
    const status = String(row.status || "");
    if (approvableCountsByStatus[role] && status in approvableCountsByStatus[role]) {
      approvableCountsByStatus[role][status] = toInt(row.total);
    }
  }

  for (const group of pendingGroups) {
    group.total = approvableCountsByStatus[group.role]?.registered ?? group.users.length;
  }

  const usersCreatedSeries = bucketTimestamps(
    recentUsersResult.rows.map((row) => row.created_at),
    trendLabels,
    safeTimeZone,
  );

  const reviewsCreatedSeries = bucketTimestamps(
    recentReviewsResult.rows.map((row) => row.created_at),
    trendLabels,
    safeTimeZone,
  );

  const helpRequestEvents = recentPostEventsResult.rows.filter(
    (row) => String(row.post_type || "") === "seek-help",
  );
  const volunteerRequestEvents = recentPostEventsResult.rows.filter(
    (row) => String(row.post_type || "") === "apply-as-volunteer",
  );

  const helpRequestsCreatedSeries = bucketTimestamps(
    helpRequestEvents.map((row) => row.created_at),
    trendLabels,
    safeTimeZone,
  );

  const volunteerRequestsCreatedSeries = bucketTimestamps(
    volunteerRequestEvents.map((row) => row.created_at),
    trendLabels,
    safeTimeZone,
  );

  const expertRequestsCreatedSeries = bucketTimestamps(
    recentExpertRequestsResult.rows.map((row) => row.created_at),
    trendLabels,
    safeTimeZone,
  );

  const approvalEvents = recentApprovalEventsResult.rows
    .map((row) => ({
      role: String(row.role || ""),
      status: String(row.status || ""),
      reviewedAt: row.reviewed_at,
    }))
    .filter((event) => APPROVABLE_ROLES.includes(event.role));

  const approvalsReviewedSeries = bucketTimestamps(
    approvalEvents.map((event) => event.reviewedAt),
    trendLabels,
    safeTimeZone,
  );

  const approvalEventsByDate = approvalEvents.reduce((accumulator, event) => {
    const key = toDateKey(event.reviewedAt, safeTimeZone);
    if (!key) {
      return accumulator;
    }

    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push(event);
    return accumulator;
  }, {});

  const approvalRangeEvents = trendLabels.flatMap((label) => approvalEventsByDate[label] || []);
  const reviewedInRange = approvalRangeEvents.length;
  const approvedInRange = approvalRangeEvents.filter((event) => event.status === "verified").length;
  const rejectedInRange = approvalRangeEvents.filter((event) => event.status === "blocked").length;

  const streamCounts = streamCountsResult.rows.map((row) => ({
    slug: String(row.post_type || ""),
    total: toInt(row.total),
    created_in_range: toInt(row.created_in_range),
  }));

  const streamMap = streamCounts.reduce((accumulator, item) => {
    accumulator[item.slug] = item;
    return accumulator;
  }, {});

  const helpRequestsTotal = streamMap["seek-help"]?.total ?? 0;
  const volunteerRequestsTotal = streamMap["apply-as-volunteer"]?.total ?? 0;
  const helpRequestsInRange = sumSeries(helpRequestsCreatedSeries);
  const volunteerRequestsInRange = sumSeries(volunteerRequestsCreatedSeries);
  const openRequestsTotal =
    toInt(expertOverview.queued_requests) +
    toInt(expertOverview.offered_requests) +
    toInt(expertOverview.assigned_requests) +
    toInt(expertOverview.connected_requests);

  return {
    range: safeRange,
    time_zone: safeTimeZone,
    headline: {
      total_users: toInt(userTotalsRow.total_users),
      pending_approvals_total: toInt(userTotalsRow.pending_approvals_total),
      pending_reviews_total: toInt(reviewSummaryRow.pending_reviews),
      help_requests_total: helpRequestsTotal,
      volunteer_requests_total: volunteerRequestsTotal,
      expert_queue_open_total: openRequestsTotal,
      available_expert_slots: toInt(expertOverview.available_slots_online),
    },
    users: {
      total_users: toInt(userTotalsRow.total_users),
      new_users_in_range: sumSeries(usersCreatedSeries),
      counts_by_role: countsByRole,
      approvable_counts_by_status: approvableCountsByStatus,
      pending_approvals: pendingGroups,
      reviewed_in_range: reviewedInRange,
      approved_in_range: approvedInRange,
      rejected_in_range: rejectedInRange,
    },
    reviews: {
      total_reviews: toInt(reviewSummaryRow.total_reviews),
      pending_reviews: toInt(reviewSummaryRow.pending_reviews),
      approved_reviews: toInt(reviewSummaryRow.approved_reviews),
      rejected_reviews: toInt(reviewSummaryRow.rejected_reviews),
      average_rating: toNumber(reviewSummaryRow.average_rating),
      created_in_range: sumSeries(reviewsCreatedSeries),
      latest_reviews: latestReviewsResult.rows,
    },
    requests_content: {
      help_requests_total: helpRequestsTotal,
      help_requests_in_range: helpRequestsInRange,
      volunteer_requests_total: volunteerRequestsTotal,
      volunteer_requests_in_range: volunteerRequestsInRange,
      content_streams_total: streamCounts.length,
      taxonomies_total: toInt(taxonomyTotalRow.total_taxonomies),
      stream_counts: streamCounts,
    },
    expert_connect: {
      queued_requests: toInt(expertOverview.queued_requests),
      offered_requests: toInt(expertOverview.offered_requests),
      assigned_requests: toInt(expertOverview.assigned_requests),
      connected_requests: toInt(expertOverview.connected_requests),
      rejected_requests_total: toInt(expertOverview.rejected_requests_total),
      rejected_requests_24h: toInt(expertOverview.rejected_requests_24h),
      rejected_requests_7d: toInt(expertOverview.rejected_requests_7d),
      top_rejection_reasons_7d: Array.isArray(expertOverview.top_rejection_reasons_7d)
        ? expertOverview.top_rejection_reasons_7d
        : [],
      total_experts: toInt(expertOverview.total_experts),
      online_experts: toInt(expertOverview.online_experts),
      total_capacity_online: toInt(expertOverview.total_capacity_online),
      active_load_online: toInt(expertOverview.active_load_online),
      available_slots_online: toInt(expertOverview.available_slots_online),
      avg_assignment_wait_seconds: toNumber(expertOverview.avg_assignment_wait_seconds),
      expert_requests_created_in_range: sumSeries(expertRequestsCreatedSeries),
      open_requests_total: openRequestsTotal,
    },
    notifications: {
      unread_count: toInt(unreadCount),
    },
    trends: {
      labels: trendLabels,
      users_created: usersCreatedSeries,
      approvals_reviewed: approvalsReviewedSeries,
      reviews_created: reviewsCreatedSeries,
      help_requests_created: helpRequestsCreatedSeries,
      volunteer_requests_created: volunteerRequestsCreatedSeries,
      expert_requests_created: expertRequestsCreatedSeries,
    },
  };
}

module.exports = {
  fetchDashboardSummary,
};
