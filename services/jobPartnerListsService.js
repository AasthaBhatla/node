// services/jobPartnerListsService.js
const pool = require("../db");
const JOB_STATUS_ALLOWED = new Set([
  "open",
  "assigned",
  "in_progress",
  "completion_requested",
  "completed",
  "disputed",
  "cancelled",
  "refunded",
]);

// -------------------------
// Helpers
// -------------------------

const safeLimitOffset = ({ page = 1, limit = 20, max = 100 } = {}) => {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lRaw = Math.max(1, parseInt(limit, 10) || 20);
  const l = Math.min(lRaw, max);
  const offset = (p - 1) * l;
  return { page: p, limit: l, offset };
};

const parseStatusSet = (csv) => {
  if (!csv) return null;
  const s = String(csv)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return s.length ? [...new Set(s)] : null;
};

function normalizeStatusSet(statuses, fallback) {
  const set = parseStatusSet(statuses) || fallback;
  const clean = set.filter((s) => JOB_STATUS_ALLOWED.has(s));
  if (!clean.length) {
    const e = new Error("Invalid statuses filter");
    e.statusCode = 400;
    throw e;
  }
  return clean;
}

// -------------------------
// Shared: fetch attachments for many jobs
// -------------------------
async function getAttachmentsByJobIds(jobIds) {
  if (!jobIds || !jobIds.length) return new Map();

  const r = await pool.query(
    `
    SELECT job_id, id, url, created_at
    FROM job_attachments
    WHERE job_id = ANY($1::bigint[])
    ORDER BY created_at ASC
  `,
    [jobIds],
  );

  const map = new Map();
  for (const row of r.rows || []) {
    if (!map.has(row.job_id)) map.set(row.job_id, []);
    map.get(row.job_id).push({
      id: row.id,
      url: row.url,
      created_at: row.created_at,
    });
  }
  return map;
}

// -------------------------
// 1) Partner: Applied jobs list
// - jobs where partner has an active application
// - job is still open & unassigned (or optionally include assigned-but-not-me, but we won't)
// - include "my_application" + applicant_count
// - allow filtering by job_status if you ever want (default: open only)
// -------------------------
async function listPartnerAppliedJobs({
  partnerId,
  page = 1,
  limit = 20,
  includeAttachments = false,
  statuses = null, // optional CSV: "open" (default)
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

  const statusSet = normalizeStatusSet(statuses, ["open"]);

  const r = await pool.query(
    `
    SELECT
      j.*,
      a.quote_credits AS my_quote_credits,
      a.message AS my_message,
      a.status AS my_application_status,
      a.created_at AS my_applied_at,
      a.updated_at AS my_application_updated_at,
      a.withdrawn_at AS my_withdrawn_at,
      (
        SELECT COUNT(*)::int
        FROM job_applications x
        WHERE x.job_id = j.id
          AND x.status = 'applied'
      ) AS applicant_count
    FROM job_applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.partner_id = $1
      AND a.status = 'applied'
      AND j.status = ANY($2::job_status[])
      AND j.assigned_partner_id IS NULL
    ORDER BY a.updated_at DESC, j.created_at DESC
    LIMIT $3 OFFSET $4
  `,
    [partnerId, statusSet, l, offset],
  );

  const rows = r.rows || [];
  const jobIds = rows.map((x) => x.id);

  let attMap = new Map();
  if (includeAttachments && jobIds.length) {
    attMap = await getAttachmentsByJobIds(jobIds);
  }

  const jobs = rows.map((x) => ({
    job: {
      id: x.id,
      client_id: x.client_id,
      title: x.title,
      case_description: x.case_description,
      case_type: x.case_type,
      location_id: x.location_id,
      urgency: x.urgency,
      budget_credits: x.budget_credits,
      status: x.status,
      assigned_partner_id: x.assigned_partner_id,
      assigned_at: x.assigned_at,
      partner_marked_complete_at: x.partner_marked_complete_at,
      client_approved_complete_at: x.client_approved_complete_at,
      cancelled_by_admin_at: x.cancelled_by_admin_at,
      metadata: x.metadata || {},
      created_at: x.created_at,
      updated_at: x.updated_at,
      applicant_count: parseInt(x.applicant_count || 0, 10),
    },
    my_application: {
      quote_credits: parseInt(x.my_quote_credits, 10),
      message: x.my_message,
      status: x.my_application_status,
      created_at: x.my_applied_at,
      updated_at: x.my_application_updated_at,
      withdrawn_at: x.my_withdrawn_at,
    },
    attachments: includeAttachments ? attMap.get(x.id) || [] : undefined,
  }));

  return { page: p, limit: l, items: jobs };
}

// -------------------------
// 2) Partner: Running jobs list (assigned to me, not completed/cancelled/refunded)
// - include escrow snapshot (amount/status) so partner can see what's pending
// - allow optional statuses filter; default excludes final states
// -------------------------
async function listPartnerRunningJobs({
  partnerId,
  page = 1,
  limit = 20,
  includeAttachments = false,
  statuses = null, // optional CSV; default: active states
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

  const defaultStatuses = [
    "assigned",
    "in_progress",
    "completion_requested",
    "disputed",
  ];
  const statusSet = normalizeStatusSet(statuses, defaultStatuses);

  const r = await pool.query(
    `
    SELECT
      j.*,
      e.id AS escrow_id,
      e.amount_credits AS escrow_amount_credits,
      e.status AS escrow_status,
      e.held_at AS escrow_held_at,
      e.released_at AS escrow_released_at,
      e.refunded_at AS escrow_refunded_at
    FROM jobs j
    LEFT JOIN job_escrow e ON e.job_id = j.id
    WHERE j.assigned_partner_id = $1
      AND j.status = ANY($2::job_status[])
    ORDER BY j.updated_at DESC, j.created_at DESC
    LIMIT $3 OFFSET $4
  `,
    [partnerId, statusSet, l, offset],
  );

  const rows = r.rows || [];
  const jobIds = rows.map((x) => x.id);

  let attMap = new Map();
  if (includeAttachments && jobIds.length) {
    attMap = await getAttachmentsByJobIds(jobIds);
  }

  const items = rows.map((x) => ({
    job: {
      id: x.id,
      client_id: x.client_id,
      title: x.title,
      case_description: x.case_description,
      case_type: x.case_type,
      location_id: x.location_id,
      urgency: x.urgency,
      budget_credits: x.budget_credits,
      status: x.status,
      assigned_partner_id: x.assigned_partner_id,
      assigned_at: x.assigned_at,
      partner_marked_complete_at: x.partner_marked_complete_at,
      client_approved_complete_at: x.client_approved_complete_at,
      cancelled_by_admin_at: x.cancelled_by_admin_at,
      metadata: x.metadata || {},
      created_at: x.created_at,
      updated_at: x.updated_at,
    },
    escrow: x.escrow_id
      ? {
          id: x.escrow_id,
          amount_credits: parseInt(x.escrow_amount_credits, 10),
          status: x.escrow_status,
          held_at: x.escrow_held_at,
          released_at: x.escrow_released_at,
          refunded_at: x.escrow_refunded_at,
        }
      : null,
    attachments: includeAttachments ? attMap.get(x.id) || [] : undefined,
  }));

  return { page: p, limit: l, items };
}

// -------------------------
// 3) Partner: Completed jobs list
// - include payout info from escrow + wallet tx (best-effort)
// - by default status = completed only
// -------------------------
async function listPartnerCompletedJobs({
  partnerId,
  page = 1,
  limit = 20,
  includeAttachments = false,
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

  const r = await pool.query(
    `
  SELECT
    j.*,
    e.id AS escrow_id,
    e.amount_credits AS escrow_amount_credits,
    e.status AS escrow_status,
    e.held_at AS escrow_held_at,
    e.released_at AS escrow_released_at,

    wt.created_at AS payout_created_at,
    wt.amount_credits AS payout_amount_credits,
    wt.idempotency_key AS payout_idempotency_key
  FROM jobs j
  LEFT JOIN job_escrow e ON e.job_id = j.id
  LEFT JOIN LATERAL (
    SELECT created_at, amount_credits, idempotency_key
    FROM wallet_transactions
    WHERE user_id = $1
      AND direction = 'credit'
      AND reason = 'job_payout'
      AND reference_kind = 'job'
      AND reference_id = j.id::text
    ORDER BY created_at DESC
    LIMIT 1
  ) wt ON TRUE
  WHERE j.assigned_partner_id = $1
    AND j.status = 'completed'
  ORDER BY j.client_approved_complete_at DESC NULLS LAST, j.updated_at DESC
  LIMIT $2 OFFSET $3
  `,
    [partnerId, l, offset],
  );

  const rows = r.rows || [];
  const jobIds = rows.map((x) => x.id);

  let attMap = new Map();
  if (includeAttachments && jobIds.length) {
    attMap = await getAttachmentsByJobIds(jobIds);
  }

  const items = rows.map((x) => ({
    job: {
      id: x.id,
      client_id: x.client_id,
      title: x.title,
      case_description: x.case_description,
      case_type: x.case_type,
      location_id: x.location_id,
      urgency: x.urgency,
      budget_credits: x.budget_credits,
      status: x.status,
      assigned_partner_id: x.assigned_partner_id,
      assigned_at: x.assigned_at,
      partner_marked_complete_at: x.partner_marked_complete_at,
      client_approved_complete_at: x.client_approved_complete_at,
      metadata: x.metadata || {},
      created_at: x.created_at,
      updated_at: x.updated_at,
    },
    escrow: x.escrow_id
      ? {
          id: x.escrow_id,
          amount_credits: parseInt(x.escrow_amount_credits, 10),
          status: x.escrow_status,
          held_at: x.escrow_held_at,
          released_at: x.escrow_released_at,
        }
      : null,
    payout: x.payout_created_at
      ? {
          created_at: x.payout_created_at,
          amount_credits: parseInt(x.payout_amount_credits, 10),
          idempotency_key: x.payout_idempotency_key,
        }
      : null,
    attachments: includeAttachments ? attMap.get(x.id) || [] : undefined,
  }));

  return { page: p, limit: l, items };
}

module.exports = {
  listPartnerAppliedJobs,
  listPartnerRunningJobs,
  listPartnerCompletedJobs,
};
