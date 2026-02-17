// middlewares/requireAdmin.js
module.exports = function requireAdmin() {
  return (req, res, next) => {
    const u = req.user;

    const isAdmin =
      u?.role === "admin" ||
      u?.user_type === "admin" ||
      u?.is_admin === true ||
      u?.is_admin === "true" ||
      u?.is_admin === 1;

    if (!isAdmin) {
      return res.status(403).json({
        status: "failure",
        body: { message: "Admin access required" },
      });
    }

    next();
  };
};
