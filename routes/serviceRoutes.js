const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const serviceController = require("../controllers/serviceController");

const router = express.Router();

router.get("/public", serviceController.publicList);
router.get("/public/filters", serviceController.publicFilters);
router.get("/public/:slug", serviceController.publicBySlug);

router.use(authMiddleware, requireAdmin());

router.post("/report", serviceController.report);
router.post("/report/summary", serviceController.summary);
router.get("/:id", serviceController.getById);
router.post("/", serviceController.create);
router.post("/:id", serviceController.update);
router.delete("/:id", serviceController.remove);

module.exports = router;
