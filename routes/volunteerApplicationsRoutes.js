// routes/volunteerApplicationsRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const requireRole = require("../middlewares/requireRole");
const c = require("../controllers/volunteerApplicationsController");

/**
 * CLIENT
 * - POST   /volunteers/ngos/:ngoUserId/apply
 * - GET    /volunteers/me/applications
 * - GET    /volunteers/me/applications/:id
 *
 * NGO
 * - GET    /volunteers/ngo/applications
 * - GET    /volunteers/ngo/applications/:id
 * - POST   /volunteers/ngo/applications/:id/decision
 */

// Client apply
router.post(
  "/ngos/:ngoUserId/apply",
  authMiddleware,
  requireRole("client"),
  c.apply,
);

// Client list & detail
router.get("/me/applications", authMiddleware, requireRole("client"), c.myList);

router.get(
  "/me/applications/:id",
  authMiddleware,
  requireRole("client"),
  c.myGet,
);

// NGO list/detail/decision
router.get("/ngo/applications", authMiddleware, requireRole("ngo"), c.ngoList);

router.get(
  "/ngo/applications/:id",
  authMiddleware,
  requireRole("ngo"),
  c.ngoGet,
);

router.post(
  "/ngo/applications/:id/decision",
  authMiddleware,
  requireRole("ngo"),
  c.ngoDecide,
);

module.exports = router;
