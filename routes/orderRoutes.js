// routes/orderRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const orderController = require("../controllers/orderController");

router.post("/", authMiddleware, orderController.create);
router.get("/me", authMiddleware, orderController.listMine);

// prefer order_id naming consistency
router.get("/me/:order_id", authMiddleware, orderController.getMineById);
router.get(
  "/me/:order_id/payment-status",
  authMiddleware,
  orderController.getMyPaymentStatus,
);
router.post("/me/:order_id/cancel", authMiddleware, orderController.cancelMine);

module.exports = router;
