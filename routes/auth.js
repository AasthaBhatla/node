const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register', authController.register);

module.exports = router;
