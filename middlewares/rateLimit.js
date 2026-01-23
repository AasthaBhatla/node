// middleware/rateLimit.js
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379");

exports.loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 2000, // per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "failure", error: "Too many requests. Try later." },
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: "rl:ip:",
  }),
});

exports.loginIdLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  limit: 10, // per identifier
  keyGenerator: (req) => {
    const b = req.body ?? {};
    const id = (b.email || b.phone || "unknown")
      .toString()
      .toLowerCase()
      .trim();
    return id || "unknown";
  },
  message: {
    status: "failure",
    error: "Too many attempts for this account. Try later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: "rl:id:",
  }),
});
