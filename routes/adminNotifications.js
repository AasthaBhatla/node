const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const notify = require("../services/notify");

// Admin-only guard
router.use(authMiddleware);
router.use((req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "Only admin" });
  next();
});

// Send to ALL users
router.post("/all", async (req, res) => {
  const { title, body, data, push, store } = req.body || {};
  const job = await notify.all({ title, body, data, push, store }, "admin.all");
  res.status(200).json({ message: "Queued", job });
});

// Send to ROLE
router.post("/role", async (req, res) => {
  const { role, title, body, data, push, store } = req.body || {};
  const job = await notify.role(
    role,
    { title, body, data, push, store },
    "admin.role",
  );
  res.status(200).json({ message: "Queued", job });
});

// Send to ONE user
router.post("/user/:id", async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { title, body, data, push, store } = req.body || {};
  const job = await notify.user(
    userId,
    { title, body, data, push, store },
    "admin.user",
  );
  res.status(200).json({ message: "Queued", job });
});

// Send to MANY users
router.post("/users", async (req, res) => {
  const { user_ids, title, body, data, push, store } = req.body || {};
  const job = await notify.users(
    user_ids,
    { title, body, data, push, store },
    "admin.users",
  );
  res.status(200).json({ message: "Queued", job });
});

module.exports = router;
