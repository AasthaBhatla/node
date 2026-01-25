const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const { loginIpLimiter, loginIdLimiter } = require("../middlewares/rateLimit");

router.post("/login", authController.login);
router.post("/verify-otp", authController.verifyOtp);
router.post("/register", authMiddleware, authController.register);
router.post("/logout", authMiddleware, authController.logout);
router.post("/resend-otp", authController.resendOtp);
router.post("/create", authMiddleware, authController.createUserWithProfile);

module.exports = router;
