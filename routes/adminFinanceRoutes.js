const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const adminFinanceController = require("../controllers/adminFinanceController");

const router = express.Router();

router.get(
  "/summary",
  authMiddleware,
  requireAdmin(),
  adminFinanceController.getSummary,
);

module.exports = router;
