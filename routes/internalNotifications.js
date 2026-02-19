// routes/internalNotifications.js
const express = require("express");
const router = express.Router();
const notify = require("../services/notify");
const internalServiceAuth = require("../middlewares/internalServiceAuth");

function normalizeEventKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ".")
    .replace(/[^a-z0-9.]/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\./, "")
    .replace(/\.$/, "");
}

function resolveEventKey(req, fallback) {
  const explicit = normalizeEventKey(req.body?.event_key);
  if (explicit) return explicit;

  const fromType = normalizeEventKey(req.body?.data?.type);
  if (fromType) return fromType;

  return fallback;
}

router.use(express.json({ limit: "1mb" })); // make sure body exists here if mounted separately

router.use(
  internalServiceAuth({
    secrets: {
      "chat-socket": process.env.INTERNAL_SECRET_CHAT_SOCKET,
      // "payments": process.env.INTERNAL_SECRET_PAYMENTS,
    },
    perms: {
      "chat-socket": { allow: ["user", "users"] }, // no "all" blasts
    },
  }),
);

function pickPayload(req) {
  const { title, body, data, push, store, channel } = req.body || {};
  return { title, body, data, push, store, channel };
}

router.post("/user/:id", async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({
        status: "failure",
        body: { message: "Invalid user id" },
      });
    }

    const eventKey = resolveEventKey(req, "internal.user");
    const job = await notify.user(userId, pickPayload(req), eventKey);

    return res.json({
      status: "success",
      body: { message: "Queued", event_key: eventKey, job },
    });
  } catch (e) {
    return res
      .status(500)
      .json({ status: "failure", body: { message: e.message } });
  }
});

router.post("/users", async (req, res) => {
  try {
    const { user_ids } = req.body || {};
    if (!Array.isArray(user_ids) || !user_ids.length) {
      return res.status(400).json({
        status: "failure",
        body: { message: "user_ids is required" },
      });
    }

    const eventKey = resolveEventKey(req, "internal.users");
    const job = await notify.users(user_ids, pickPayload(req), eventKey);

    return res.json({
      status: "success",
      body: { message: "Queued", event_key: eventKey, job },
    });
  } catch (e) {
    return res
      .status(500)
      .json({ status: "failure", body: { message: e.message } });
  }
});

module.exports = router;
