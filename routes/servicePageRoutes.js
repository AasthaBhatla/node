const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const servicePageController = require("../controllers/servicePageController");

const router = express.Router();

router.get("/public", servicePageController.publicList);
router.get("/public/:locale/:slug", servicePageController.publicBySlug);

router.use(authMiddleware, requireAdmin());

router.post("/report", servicePageController.report);
router.post("/report/summary", servicePageController.summary);
router.get("/:id", servicePageController.getById);
router.post("/", servicePageController.create);
router.post("/:id", servicePageController.update);
router.delete("/:id", servicePageController.remove);

module.exports = router;
