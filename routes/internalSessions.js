const express = require("express");
const router = express.Router();

const internalServiceAuth = require("../middlewares/internalServiceAuth");
const sessionService = require("../services/sessionService");

const toSessionClock = (session) => {
  if (!session) return null;
  return {
    sessionId: String(session.session_id),
    startedAt: session.started_at,
    endedAt: session.ended_at || null,
    status: session.status,
    sessionType: session.session_type,
    rateCreditsPerMin: Number(session.rate_credits_per_min || 0),
    totalMinutesBilled: Number(session.total_minutes_billed || 0),
    totalCreditsBilled: Number(session.total_credits_billed || 0),
    billingPausedAt: session.billing_paused_at || null,
    totalPausedMs: Number(session.total_paused_ms || 0),
  };
};

router.use(
  internalServiceAuth({
    secrets: {
      "chat-socket": process.env.INTERNAL_SECRET_CHAT_SOCKET,
    },
    perms: {
      "chat-socket": { allow: ["session"] },
    },
    resolveAction: () => "session",
  }),
);

router.post("/start", async (req, res) => {
  try {
    const {
      user_id,
      partner_id,
      session_type,
      rate_credits_per_min,
      metadata,
    } = req.body || {};

    const data = await sessionService.startSession({
      userId: user_id,
      partnerId: partner_id,
      sessionType: session_type,
      rateCreditsPerMin: rate_credits_per_min,
      metadata,
    });

    return res.json({
      ...data,
      sessionClock: toSessionClock(data.session),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
});

router.post("/:session_id/heartbeat", async (req, res) => {
  try {
    const data = await sessionService.billDueMinutesForSession({
      userId: req.body?.user_id,
      sessionId: req.params.session_id,
      maxMinutes: req.body?.max_minutes,
      now: new Date(),
    });

    return res.json({
      ...data,
      sessionClock: toSessionClock(data.session),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
});

router.post("/:session_id/pause", async (req, res) => {
  try {
    const data = await sessionService.pauseSession({
      userId: req.body?.user_id,
      sessionId: req.params.session_id,
      pausedAt: req.body?.paused_at,
    });

    return res.json({
      ...data,
      sessionClock: toSessionClock(data.session),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
});

router.post("/:session_id/resume", async (req, res) => {
  try {
    const data = await sessionService.resumeSession({
      userId: req.body?.user_id,
      sessionId: req.params.session_id,
    });

    return res.json({
      ...data,
      sessionClock: toSessionClock(data.session),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
});

router.post("/:session_id/end", async (req, res) => {
  try {
    const data = await sessionService.endSession({
      userId: req.body?.user_id,
      sessionId: req.params.session_id,
      endedReason: req.body?.ended_reason,
    });

    return res.json({
      ...data,
      sessionClock: toSessionClock(data.session),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
});

module.exports = router;
