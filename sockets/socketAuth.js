// sockets/socketAuth.js
const jwt = require("jsonwebtoken");

function getJwtSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.ACCESS_TOKEN_SECRET ||
    process.env.TOKEN_SECRET
  );
}

function extractToken(socket) {
  const authToken = socket?.handshake?.auth?.token;
  if (authToken) return authToken;

  const hdr = socket?.handshake?.headers?.authorization || "";
  const m = String(hdr).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];

  const qToken = socket?.handshake?.query?.token;
  if (qToken) return qToken;

  return null;
}

function normalizePayloadUser(payload) {
  const userId =
    payload?.id ??
    payload?.user_id ??
    payload?.user?.id ??
    payload?.sub ??
    null;

  const role = payload?.role ?? payload?.user?.role ?? null;

  const idNum = Number(userId);
  if (!Number.isInteger(idNum) || idNum < 1) return null;

  return { id: idNum, role: role ? String(role) : null };
}

function applySocketAuth(io) {
  io.use((socket, next) => {
    try {
      const secret = getJwtSecret();
      if (!secret) return next(new Error("JWT secret missing"));

      const token = extractToken(socket);
      if (!token) return next(new Error("Auth token missing"));

      const payload = jwt.verify(token, secret);
      const user = normalizePayloadUser(payload);
      if (!user) return next(new Error("Invalid token payload"));

      socket.user = user;
      return next();
    } catch (e) {
      return next(new Error("Unauthorized"));
    }
  });
}

module.exports = applySocketAuth;
