const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const blogController = require("../controllers/blogController");

const router = express.Router();

router.get("/public", blogController.publicList);
router.get("/public/filters", blogController.publicFilters);
router.get("/public/:slug", blogController.publicBySlug);

router.use(authMiddleware, requireAdmin());

router.post("/report", blogController.report);
router.get("/:id", blogController.getById);
router.post("/", blogController.create);
router.post("/:id", blogController.update);
router.delete("/:id", blogController.remove);

module.exports = router;
