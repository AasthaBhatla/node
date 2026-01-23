// controllers/walletController.js
const {
  getWalletBalance,
  debitWallet,
  getWalletTransactions,
} = require("../services/walletService");

// wallet_reason Option A enum set
const ALLOWED_REASONS = new Set(["topup", "session", "refund", "adjustment"]);

exports.getMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const balance = await getWalletBalance(userId);
    return res.json({ balance_credits: balance });
  } catch (err) {
    console.error("Error in wallet getMe:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};

exports.debitMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const amount = parseInt(req.body.amount, 10);

    const reasonRaw = req.body.reason ? String(req.body.reason) : "session";
    const reason = reasonRaw.toLowerCase().trim();

    if (!ALLOWED_REASONS.has(reason)) {
      return res.status(400).json({
        error: `Invalid reason. Allowed: ${Array.from(ALLOWED_REASONS).join(", ")}`,
      });
    }

    const reference_kind = req.body.reference_kind
      ? String(req.body.reference_kind)
      : null;
    const reference_id = req.body.reference_id
      ? String(req.body.reference_id)
      : null;

    const idempotency_key = req.body.idempotency_key
      ? String(req.body.idempotency_key)
      : null;

    const metadata =
      req.body.metadata && typeof req.body.metadata === "object"
        ? req.body.metadata
        : null;

    const result = await debitWallet({
      userId,
      amount,
      reason,
      reference_kind,
      reference_id,
      idempotency_key,
      metadata,
    });

    return res.json(result);
  } catch (err) {
    console.error("Error in wallet debitMe:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};

exports.getMyTransactions = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const tx = await getWalletTransactions({ userId, limit, offset });
    return res.json(tx);
  } catch (err) {
    console.error("Error in wallet getMyTransactions:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};
