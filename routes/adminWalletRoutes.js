const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const adminWalletController = require("../controllers/adminWalletController");

const router = express.Router();

router.get(
  "/users/:user_id/balance",
  authMiddleware,
  requireAdmin(),
  adminWalletController.getUserBalance,
);

router.get(
  "/users/:user_id/transactions",
  authMiddleware,
  requireAdmin(),
  adminWalletController.getUserTransactions,
);

router.get(
  "/users/:user_id/sessions",
  authMiddleware,
  requireAdmin(),
  adminWalletController.getUserSessionGroups,
);

router.post(
  "/users/:user_id/payouts",
  authMiddleware,
  requireAdmin(),
  adminWalletController.createUserPayout,
);

module.exports = router;
