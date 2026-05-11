const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const profileDocumentController = require("../controllers/profileDocumentController");

const router = express.Router();

router.use(authMiddleware, requireAdmin());
router.get("/", profileDocumentController.listAdmin);
router.post("/:id/status", profileDocumentController.updateStatus);
router.post("/:id/versions", profileDocumentController.addVersion);

module.exports = router;
