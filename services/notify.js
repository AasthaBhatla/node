// services/notify.js
const { DateTime } = require("luxon");
const {
  enqueueJob,
  cancelScheduledJobs,
} = require("./notificationQueueService");

const DEFAULT_ZONE = process.env.NOTIF_TIMEZONE || "Asia/Kolkata";

/**
 * Payload normalizer (shared by immediate + scheduled)
 */
function normalizePayload(payload = {}) {
  const title = String(payload.title || "").trim();
  const body = String(payload.body || "").trim();
  const data =
    payload.data && typeof payload.data === "object" ? payload.data : {};
  const push = payload.push !== false; // default true
  const store = payload.store !== false; // default true
  const channel = payload.channel || "push";

  if (!title || !body)
    throw new Error("notify payload requires title and body");

  return { title, body, data, push, store, channel };
}

/**
 * Parse run_at and store as UTC ISO string for consistency.
 *
 * Accepts:
 * - ISO string with offset: "2026-02-15T18:00:00+05:30"  (recommended)
 * - ISO without offset:     "2026-02-15T18:00:00"        (assumed DEFAULT_ZONE)
 */
function normalizeRunAt(run_at) {
  if (!run_at) return null;

  if (typeof run_at !== "string") {
    throw new Error("run_at must be an ISO datetime string");
  }

  const s = run_at.trim();
  if (!s) throw new Error("run_at must be a non-empty string");

  // If it includes a zone/offset (Z, +05:30), Luxon will honor it.
  // If not, we assume DEFAULT_ZONE (Asia/Kolkata).
  let dt = DateTime.fromISO(s, { setZone: true });
  if (!dt.isValid) {
    dt = DateTime.fromISO(s, { zone: DEFAULT_ZONE });
  }
  if (!dt.isValid) throw new Error("run_at is not a valid ISO datetime");

  // Store as UTC ISO for DB timestamp parsing consistency.
  return dt.toUTC().toISO();
}

/**
 * IMMEDIATE: one user
 */
async function user(userId, payload, event_key = "custom.user") {
  return enqueueJob({
    event_key,
    target_type: "user",
    target_value: { user_id: Number(userId) },
    payload: normalizePayload(payload),
    run_at: null,
  });
}

/**
 * IMMEDIATE: many users
 */
async function users(userIds = [], payload, event_key = "custom.users") {
  const ids = (Array.isArray(userIds) ? userIds : [])
    .map((x) => parseInt(x, 10))
    .filter(Number.isFinite);

  if (!ids.length) throw new Error("users() requires userIds");

  return enqueueJob({
    event_key,
    target_type: "users",
    target_value: { user_ids: ids },
    payload: normalizePayload(payload),
    run_at: null,
  });
}

/**
 * IMMEDIATE: role
 */
async function role(role, payload, event_key = "custom.role") {
  const r = String(role || "")
    .toLowerCase()
    .trim();
  if (!r) throw new Error("role() requires role");

  return enqueueJob({
    event_key,
    target_type: "role",
    target_value: { role: r },
    payload: normalizePayload(payload),
    run_at: null,
  });
}

/**
 * IMMEDIATE: all
 */
async function all(payload, event_key = "custom.all") {
  return enqueueJob({
    event_key,
    target_type: "all",
    target_value: {},
    payload: normalizePayload(payload),
    run_at: null,
  });
}

/**
 * SCHEDULED: one user at a specific time
 *
 * Signature kept consistent with your current style:
 *   userAt(userId, payload, run_at, event_key?)
 */
async function userAt(
  userId,
  payload,
  run_at,
  event_key = "custom.user.scheduled",
) {
  const runAtUtcIso = normalizeRunAt(run_at);

  return enqueueJob({
    event_key,
    target_type: "user",
    target_value: { user_id: Number(userId) },
    payload: normalizePayload(payload),
    run_at: runAtUtcIso,
  });
}

/**
 * OPTIONAL (but handy): scheduled many users
 */
async function usersAt(
  userIds = [],
  payload,
  run_at,
  event_key = "custom.users.scheduled",
) {
  const ids = (Array.isArray(userIds) ? userIds : [])
    .map((x) => parseInt(x, 10))
    .filter(Number.isFinite);

  if (!ids.length) throw new Error("usersAt() requires userIds");

  const runAtUtcIso = normalizeRunAt(run_at);

  return enqueueJob({
    event_key,
    target_type: "users",
    target_value: { user_ids: ids },
    payload: normalizePayload(payload),
    run_at: runAtUtcIso,
  });
}

/**
 * OPTIONAL: scheduled role
 */
async function roleAt(
  role,
  payload,
  run_at,
  event_key = "custom.role.scheduled",
) {
  const r = String(role || "")
    .toLowerCase()
    .trim();
  if (!r) throw new Error("roleAt() requires role");

  const runAtUtcIso = normalizeRunAt(run_at);

  return enqueueJob({
    event_key,
    target_type: "role",
    target_value: { role: r },
    payload: normalizePayload(payload),
    run_at: runAtUtcIso,
  });
}

/**
 * OPTIONAL: scheduled broadcast
 */
async function allAt(payload, run_at, event_key = "custom.all.scheduled") {
  const runAtUtcIso = normalizeRunAt(run_at);

  return enqueueJob({
    event_key,
    target_type: "all",
    target_value: {},
    payload: normalizePayload(payload),
    run_at: runAtUtcIso,
  });
}
async function cancelScheduled(filter, event_key = "custom.cancel.scheduled") {
  // event_key is just for your logs/consistency; not stored unless you want
  return cancelScheduledJobs(filter);
}
module.exports = {
  user,
  users,
  role,
  all,
  userAt,
  usersAt,
  roleAt,
  allAt,
  cancelScheduled,
};
