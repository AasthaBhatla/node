const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const profileDocumentController = require("../controllers/profileDocumentController");

const router = express.Router();

router.get("/me", authMiddleware, profileDocumentController.listMine);

router.use("/admin", authMiddleware, requireAdmin());
router.get("/admin", profileDocumentController.listAdmin);
router.post("/admin/:id/status", profileDocumentController.updateStatus);
router.post("/admin/:id/versions", profileDocumentController.addVersion);

module.exports = router;
