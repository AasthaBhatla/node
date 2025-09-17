/*
const express = require("express");
const router = express.Router();
const bannerController = require("../controllers/bannerController");
const authMiddleware = require("../middlewares/authMiddleware");


router.get("/", bannerController.getAll);
router.get("/:id", bannerController.getById);
router.post("/", authMiddleware, bannerController.create);
router.put("/:id", authMiddleware, bannerController.update);
router.delete("/:id", authMiddleware, bannerController.delete);

module.exports = router;
*/