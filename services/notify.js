const { enqueueJob } = require("./notificationQueueService");

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

async function user(userId, payload, event_key = "custom.user") {
  return enqueueJob({
    event_key,
    target_type: "user",
    target_value: { user_id: Number(userId) },
    payload: normalizePayload(payload),
  });
}

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
  });
}

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
  });
}

async function all(payload, event_key = "custom.all") {
  return enqueueJob({
    event_key,
    target_type: "all",
    target_value: {},
    payload: normalizePayload(payload),
  });
}

module.exports = { user, users, role, all };

// Example usage

// const notify = require("../services/notify");

// For individual user
// // Example: after order paid
// await notify.user(order.user_id, {
//   title: "Payment received",
//   body: `Your order #${order.id} is confirmed.`,
//   data: { type: "order_paid", order_id: order.id },
//   push: true,
//   store: true,
// }, "order.paid");


// For Broadcast
// await notify.all({
//   title: "Big announcement",
//   body: "New features launched!",
//   data: { type: "campaign" },
//   push: true,
//   store: true,
// }, "campaign.broadcast");
