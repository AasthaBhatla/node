const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const adminDashboardController = require("../controllers/adminDashboardController");

const router = express.Router();

router.get(
  "/summary",
  authMiddleware,
  requireAdmin(),
  adminDashboardController.getSummary,
);

module.exports = router;
