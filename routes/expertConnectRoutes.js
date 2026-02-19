// routes/expertConnectRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const requireRole = require("../middlewares/requireRole");
const expertConnectController = require("../controllers/expertConnectController");

router.post(
  "/request",
  authMiddleware,
  requireRole("client", { allowAdmin: false }),
  expertConnectController.createConnectionRequest,
);

router.get(
  "/request/:id/status",
  authMiddleware,
  requireRole(["admin"]),
  expertConnectController.getRequestStatus,
);

router.post(
  "/request/:id/cancel",
  authMiddleware,
  requireRole("client"),
  expertConnectController.cancelRequest,
);

router.post(
  "/expert/me/online",
  authMiddleware,
  requireRole("expert"),
  expertConnectController.updateMyOnlineStatus,
);

router.post(
  "/request/:id/connect",
  authMiddleware,
  requireRole(["expert", "client"]),
  expertConnectController.markConnected,
);

router.post(
  "/request/:id/complete",
  authMiddleware,
  requireRole(["expert", "client"]),
  expertConnectController.markCompleted,
);

router.get(
  "/queue/overview",
  authMiddleware,
  requireRole("admin", { allowAdmin: false }),
  expertConnectController.getQueueOverview,
);

// Expert inbox - see offers assigned to me that need my approval
router.get(
  "/expert/me/offers",
  authMiddleware,
  requireRole("expert"),
  expertConnectController.getMyOffers,
);

// Expert accepts an offer
router.post(
  "/request/:id/accept",
  authMiddleware,
  requireRole("expert"),
  expertConnectController.acceptOffer,
);

// Expert rejects an offer (optional reason)
router.post(
  "/request/:id/reject",
  authMiddleware,
  requireRole("expert"),
  expertConnectController.rejectOffer,
);

router.get(
  "/me/active",
  authMiddleware,
  requireRole(["client", "expert"]),
  expertConnectController.getMyActiveRequest,
);

router.get(
  "/expert/me/offers",
  authMiddleware,
  requireRole("expert"),
  expertConnectController.getMyOffers,
)

module.exports = router;
