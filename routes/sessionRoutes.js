// routes/sessionRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const sessionController = require("../controllers/sessionController");

// Start a session (bills minute 1 immediately)
router.post("/start", authMiddleware, sessionController.start);

// Heartbeat: frontend calls every minute (or burst catch-up)
router.post(
  "/me/:session_id/heartbeat",
  authMiddleware,
  sessionController.heartbeat,
);

// End session
router.post("/me/:session_id/end", authMiddleware, sessionController.end);

// List my sessions
router.get("/me", authMiddleware, sessionController.listMine);

module.exports = router;
