const crypto = require("crypto");

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function internalServiceAuth(options = {}) {
  const {
    // serviceName -> secret
    secrets = {},
    // serviceName -> { allow: ["user", "users", "role", "all", "schedule"] }
    perms = {},
    // seconds
    maxSkewSec = 300,
    // derive "action" from request for permission check
    resolveAction = (req) => {
      // you can customize this mapping
      const p = req.path || "";
      if (p.includes("/all")) return "all";
      if (p.includes("/role")) return "role";
      if (p.includes("/users")) return "users";
      if (p.includes("/user/")) return "user";
      return "unknown";
    },
  } = options;

  return function (req, res, next) {
    try {
      const serviceName = String(req.header("X-Service-Name") || "").trim();
      const tsRaw = String(req.header("X-Timestamp") || "").trim();
      const sig = String(req.header("X-Signature") || "").trim();

      if (!serviceName || !tsRaw || !sig) {
        return res.status(401).json({
          status: "failure",
          body: { message: "Missing internal auth headers" },
        });
      }

      const secret = secrets[serviceName];
      if (!secret) {
        return res.status(403).json({
          status: "failure",
          body: { message: "Unknown service" },
        });
      }

      const ts = Number(tsRaw);
      if (!Number.isFinite(ts)) {
        return res.status(401).json({
          status: "failure",
          body: { message: "Invalid timestamp" },
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSec - ts) > maxSkewSec) {
        return res.status(401).json({
          status: "failure",
          body: { message: "Stale timestamp" },
        });
      }

      const bodyStr =
        req.body && Buffer.isBuffer(req.body)
          ? req.body.toString("utf8")
          : JSON.stringify(req.body || {});
      const bodyHash = sha256Hex(bodyStr);

      const method = String(req.method || "POST").toUpperCase();
      const path = req.originalUrl || req.path || ""; // includes query if present
      const baseString = `${ts}.${method}.${path}.${bodyHash}`;

      const expected = crypto
        .createHmac("sha256", secret)
        .update(baseString)
        .digest("hex");

      if (!timingSafeEqual(expected, sig)) {
        return res.status(401).json({
          status: "failure",
          body: { message: "Bad signature" },
        });
      }

      // Permission check
      const action = resolveAction(req);
      const allow = perms?.[serviceName]?.allow || [];
      if (allow.length && !allow.includes(action)) {
        return res.status(403).json({
          status: "failure",
          body: { message: `Service not allowed for action: ${action}` },
        });
      }

      req.internalService = { name: serviceName, action };
      next();
    } catch (e) {
      return res.status(500).json({
        status: "failure",
        body: { message: e?.message || "Internal auth error" },
      });
    }
  };
}

module.exports = internalServiceAuth;
