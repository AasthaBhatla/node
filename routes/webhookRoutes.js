const express = require("express");
const router = express.Router();
const webhookController = require("../controllers/webhookController");

// POST /webhooks/razorpay
router.post("/", webhookController.razorpay);

module.exports = router;
