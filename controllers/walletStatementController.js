// controllers/walletStatementController.js
const walletStatementService = require("../services/walletStatementService");

const parsePosInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

exports.listSessionStatement = async (req, res) => {
  try {
    const me = req.user;
    if (!me?.id) return res.status(401).json({ error: "Unauthorized" });

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    // Admin can request another user's statement via ?user_id
    const requestedUserId = req.query.user_id
      ? parsePosInt(req.query.user_id)
      : null;

    const data = await walletStatementService.listSessionStatement({
      authUser: me,
      requestedUserId,
      limit,
      offset,
      status: req.query.status ? String(req.query.status) : null, // optional: active|ended
      session_type: req.query.session_type
        ? String(req.query.session_type)
        : null, // optional: call|chat
    });

    return res.json(data);
  } catch (err) {
    console.error("Error in listSessionStatement:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};

exports.getSessionStatementById = async (req, res) => {
  try {
    const me = req.user;
    if (!me?.id) return res.status(401).json({ error: "Unauthorized" });

    const sessionId = parsePosInt(req.params.session_id);
    if (!sessionId)
      return res.status(400).json({ error: "Invalid session_id" });

    const data = await walletStatementService.getSessionStatementById({
      authUser: me,
      sessionId,
    });

    return res.json(data);
  } catch (err) {
    console.error("Error in getSessionStatementById:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};
