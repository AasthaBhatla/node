// routes/internalNotifications.js
const express = require("express");
const router = express.Router();
const notify = require("../services/notify");
const internalServiceAuth = require("../middlewares/internalServiceAuth");

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
    const job = await notify.user(userId, pickPayload(req), "internal.user");
    return res.json({ status: "success", body: { message: "Queued", job } });
  } catch (e) {
    return res
      .status(500)
      .json({ status: "failure", body: { message: e.message } });
  }
});

router.post("/users", async (req, res) => {
  try {
    const { user_ids } = req.body || {};
    const job = await notify.users(
      user_ids,
      pickPayload(req),
      "internal.users",
    );
    return res.json({ status: "success", body: { message: "Queued", job } });
  } catch (e) {
    return res
      .status(500)
      .json({ status: "failure", body: { message: e.message } });
  }
});

module.exports = router;
