// middlewares/requireRole.js
/**
 * Usage:
 *   router.get("/x", authMiddleware, requireRole("client"), handler)
 *   router.get("/y", authMiddleware, requireRole(["partner", "admin"]), handler)
 *
 * Notes:
 * - Uses req.user.role
 * - Case-insensitive match
 * - "admin" bypass is allowed by default (use allowAdmin: false to disable)
 * - Returns consistent API shape: { status, body }
 */

function failure(res, message = "Forbidden", statusCode = 403) {
  return res.status(statusCode).json({
    status: "failure",
    body: { message },
  });
}

function requireRole(roles, opts = {}) {
  const { allowAdmin = true, message = "Forbidden" } = opts;
  const allowed = Array.isArray(roles) ? roles : [roles];

  const normalizedAllowed = allowed
    .map((r) => String(r).toLowerCase().trim())
    .filter(Boolean);

  return (req, res, next) => {
    const role = String(req.user?.role || "")
      .toLowerCase()
      .trim();

    if (!role) {
      return failure(res, message, 403);
    }

    if (allowAdmin && role === "admin") {
      return next();
    }

    if (!normalizedAllowed.includes(role)) {
      return failure(res, message, 403);
    }

    return next();
  };
}

module.exports = requireRole;
