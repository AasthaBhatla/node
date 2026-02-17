// routes/adminEmailRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const emailController = require("../controllers/emailController");

// Admin-only email APIs
router.post(
  "/send",
  authMiddleware,
  requireAdmin(),
  emailController.sendSingle,
);
router.post("/bulk", authMiddleware, requireAdmin(), emailController.sendBulk);

module.exports = router;
