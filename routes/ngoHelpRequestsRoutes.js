// routes/ngoHelpRequestsRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const requireRole = require("../middlewares/requireRole");
const c = require("../controllers/ngoHelpRequestsController");

/**
 * CLIENT
 * - POST   /ngo-help/ngos/:ngoUserId/apply
 * - GET    /ngo-help/me/requests
 * - GET    /ngo-help/me/requests/:id
 * - POST   /ngo-help/me/requests/:id/withdraw
 *
 * NGO
 * - GET    /ngo-help/ngo/requests
 * - GET    /ngo-help/ngo/requests/:id
 * - POST   /ngo-help/ngo/requests/:id/decision
 */

// CLIENT: apply to NGO for help
router.post(
  "/ngos/:ngoUserId/apply",
  authMiddleware,
  requireRole("client"),
  c.apply,
);

// CLIENT: list & detail
router.get("/me/requests", authMiddleware, requireRole("client"), c.myList);

router.get("/me/requests/:id", authMiddleware, requireRole("client"), c.myGet);

// CLIENT: withdraw request
router.post(
  "/me/requests/:id/withdraw",
  authMiddleware,
  requireRole("client"),
  c.myWithdraw,
);

// NGO: list & detail & decision
router.get("/ngo/requests", authMiddleware, requireRole("ngo"), c.ngoList);

router.get("/ngo/requests/:id", authMiddleware, requireRole("ngo"), c.ngoGet);

router.post(
  "/ngo/requests/:id/decision",
  authMiddleware,
  requireRole("ngo"),
  c.ngoDecide,
);

module.exports = router;
