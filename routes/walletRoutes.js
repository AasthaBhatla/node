const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const walletController = require("../controllers/walletController");
const walletStatementController = require("../controllers/walletStatementController");

// Current balance (fast)
router.get("/me", authMiddleware, walletController.getMe);

// Debit (spend credits) - auth required
router.post("/debit", authMiddleware, walletController.debitMe);

// Statement / history (minute-level raw ledger)
router.get(
  "/me/transactions",
  authMiddleware,
  walletController.getMyTransactions,
);

/**
 * - User: returns sessions where user is client or partner
 * - Admin: can pass ?user_id=XYZ to get for any user
 */
router.get(
  "/statement/sessions",
  authMiddleware,
  walletStatementController.listSessionStatement,
);

// Session-wise statement for one session_id (authorization enforced)
router.get(
  "/statement/sessions/:session_id",
  authMiddleware,
  walletStatementController.getSessionStatementById,
);

module.exports = router;
