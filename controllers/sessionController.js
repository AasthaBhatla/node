// controllers/sessionController.js
const sessionService = require("../services/sessionService");

const parsePosInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

exports.start = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { partner_id, session_type, rate_credits_per_min, metadata } =
      req.body || {};

    const data = await sessionService.startSession({
      userId,
      partnerId: partner_id,
      sessionType: session_type,
      rateCreditsPerMin: rate_credits_per_min,
      metadata,
    });

    return res.json(data);
  } catch (err) {
    console.error("Error in session start:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
};

exports.heartbeat = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const sessionId = parsePosInt(req.params.session_id);
    if (!sessionId)
      return res.status(400).json({ error: "Invalid session_id" });

    const maxMinutesRaw = req.body?.max_minutes;
    const maxMinutes = maxMinutesRaw == null ? 1 : parseInt(maxMinutesRaw, 10);

    const data = await sessionService.billDueMinutesForSession({
      userId,
      sessionId,
      maxMinutes,
      now: new Date(),
    });

    return res.json(data);
  } catch (err) {
    console.error("Error in session heartbeat:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
};

exports.end = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const sessionId = parsePosInt(req.params.session_id);
    if (!sessionId)
      return res.status(400).json({ error: "Invalid session_id" });

    const ended_reason = req.body?.ended_reason
      ? String(req.body.ended_reason)
      : null;

    const data = await sessionService.endSession({
      userId,
      sessionId,
      endedReason: ended_reason,
    });

    return res.json(data);
  } catch (err) {
    console.error("Error in session end:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
};

exports.listMine = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const data = await sessionService.listMySessions({ userId, limit, offset });
    return res.json(data);
  } catch (err) {
    console.error("Error in session listMine:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
};
