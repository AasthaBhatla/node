// routes/adminNotifications.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const notify = require("../services/notify");

// Admin-only guard
router.use(authMiddleware);
router.use((req, res, next) => {
  if (String(req.user?.role || "").toLowerCase() !== "admin") {
    return res
      .status(403)
      .json({ status: "failure", body: { message: "Only admin" } });
  }
  next();
});

function failure(res, message, statusCode = 400) {
  return res.status(statusCode).json({ status: "failure", body: { message } });
}

function pickPayload(req) {
  const { title, body, data, push, store, channel } = req.body || {};
  return { title, body, data, push, store, channel };
}

function requireRunAt(req, res) {
  const run_at = req.body?.run_at;
  if (!run_at || typeof run_at !== "string" || !run_at.trim()) {
    failure(
      res,
      "run_at is required (ISO string). Example: 2026-02-15T18:00:00+05:30",
      400,
    );
    return null;
  }
  return run_at.trim();
}

/**
 * IMMEDIATE
 */

// Send to ALL users
router.post("/all", async (req, res) => {
  try {
    const job = await notify.all(pickPayload(req), "admin.all");
    return res
      .status(200)
      .json({ status: "success", body: { message: "Queued", job } });
  } catch (err) {
    return failure(res, err?.message || "Failed to queue", 500);
  }
});

// Send to ROLE
router.post("/role", async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!role) return failure(res, "role is required");

    const job = await notify.role(role, pickPayload(req), "admin.role");
    return res
      .status(200)
      .json({ status: "success", body: { message: "Queued", job } });
  } catch (err) {
    return failure(res, err?.message || "Failed to queue", 500);
  }
});

// Send to ONE user
router.post("/user/:id", async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) return failure(res, "Invalid user id");

    const payload = pickPayload(req);

    // Prefer explicit event_key, else use data.type, else fallback
    const rawEventKey = String(req.body?.event_key || "").trim();
    const rawType = String(payload?.data?.type || "").trim();

    const chosen = rawEventKey || rawType || "admin.user";

    // Normalize: "Marketing_Shopping" -> "marketing.shopping"
    const eventKey = chosen
      .toLowerCase()
      .replace(/[\s_]+/g, ".")
      .replace(/[^a-z0-9.]/g, "")
      .replace(/\.+/g, ".")
      .replace(/^\./, "")
      .replace(/\.$/, "");

    if (!eventKey) return failure(res, "Invalid event key/type");

    const job = await notify.user(userId, payload, eventKey);

    return res.status(200).json({
      status: "success",
      body: { message: "Queued", event_key: eventKey, job },
    });
  } catch (err) {
    return failure(res, err?.message || "Failed to queue", 500);
  }
});

// Send to MANY users
router.post("/users", async (req, res) => {
  try {
    const { user_ids } = req.body || {};
    if (!Array.isArray(user_ids) || !user_ids.length) {
      return failure(res, "user_ids[] is required");
    }

    const job = await notify.users(user_ids, pickPayload(req), "admin.users");
    return res
      .status(200)
      .json({ status: "success", body: { message: "Queued", job } });
  } catch (err) {
    return failure(res, err?.message || "Failed to queue", 500);
  }
});

/**
 * SCHEDULED
 */

// Schedule to ALL users
router.post("/all/schedule", async (req, res) => {
  try {
    const run_at = requireRunAt(req, res);
    if (!run_at) return;

    const job = await notify.allAt(
      pickPayload(req),
      run_at,
      "admin.all.scheduled",
    );
    return res
      .status(200)
      .json({ status: "success", body: { message: "Scheduled", job } });
  } catch (err) {
    return failure(res, err?.message || "Failed to schedule", 500);
  }
});

// Schedule to ROLE
router.post("/role/schedule", async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!role) return failure(res, "role is required");

    const run_at = requireRunAt(req, res);
    if (!run_at) return;

    const job = await notify.roleAt(
      role,
      pickPayload(req),
      run_at,
      "admin.role.scheduled",
    );
    return res
      .status(200)
      .json({ status: "success", body: { message: "Scheduled", job } });
  } catch (err) {
    return failure(res, err?.message || "Failed to schedule", 500);
  }
});

// Schedule to ONE user
router.post("/user/:id/schedule", async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) return failure(res, "Invalid user id");

    const run_at = requireRunAt(req, res);
    if (!run_at) return;

    const job = await notify.userAt(
      userId,
      pickPayload(req),
      run_at,
      "admin.user.scheduled",
    );

    return res
      .status(200)
      .json({ status: "success", body: { message: "Scheduled", job } });
  } catch (err) {
    return failure(res, err?.message || "Failed to schedule", 500);
  }
});

// Schedule to MANY users
router.post("/users/schedule", async (req, res) => {
  try {
    const { user_ids } = req.body || {};
    if (!Array.isArray(user_ids) || !user_ids.length) {
      return failure(res, "user_ids[] is required");
    }

    const run_at = requireRunAt(req, res);
    if (!run_at) return;

    const job = await notify.usersAt(
      user_ids,
      pickPayload(req),
      run_at,
      "admin.users.scheduled",
    );

    return res
      .status(200)
      .json({ status: "success", body: { message: "Scheduled", job } });
  } catch (err) {
    return failure(res, err?.message || "Failed to schedule", 500);
  }
});

module.exports = router;
