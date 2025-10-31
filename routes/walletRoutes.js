const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");

router.get("/:userId", walletController.getByUserId);
router.post("/reduce", walletController.reduceBalance);

module.exports = router;
