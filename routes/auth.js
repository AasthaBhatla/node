const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register', authMiddleware, authController.register);
router.post('/logout', authMiddleware, authController.logout);
router.post('/resend-otp', authController.resendOtp);
router.get('/me', authMiddleware, authController.getMe);
router.post('/me', authMiddleware, authController.updateMe);
router.get('/users', authMiddleware, authController.getUsers);
router.get('/user/:id', authMiddleware, authController.getUserById);
router.post('/user/:id/update-meta', authMiddleware, authController.updateUserMetaByAdmin);

module.exports = router;
