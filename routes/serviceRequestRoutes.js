const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const serviceRequestController = require("../controllers/serviceRequestController");

const router = express.Router();

router.post("/checkout", authMiddleware, serviceRequestController.checkout);
router.get("/me", authMiddleware, serviceRequestController.listMine);
router.get("/me/:id", authMiddleware, serviceRequestController.getMineById);

router.use(authMiddleware, requireAdmin());

router.post("/report", serviceRequestController.report);
router.get("/:id", serviceRequestController.getById);
router.post("/:id/status", serviceRequestController.updateStatus);

module.exports = router;
