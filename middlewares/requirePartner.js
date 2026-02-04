function failure(res, message = "Forbidden", statusCode = 403) {
  return res.status(statusCode).json({ status: "failure", body: { message } });
}

const PARTNER_ROLES = new Set(["officer", "lawyer", "ngo"]);

function requirePartner(opts = {}) {
  const {
    message = "Only partners can access this endpoint",
    allowAdmin = true,
  } = opts;

  return (req, res, next) => {
    const role = String(req.user?.role || "")
      .toLowerCase()
      .trim();
    if (allowAdmin && role === "admin") return next();
    if (!PARTNER_ROLES.has(role)) return failure(res, message, 403);
    return next();
  };
}

module.exports = requirePartner;
