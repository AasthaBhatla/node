/*
const express = require('express');
const router = express.Router();
const partnerController = require('../controllers/partnerController');
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/filters', partnerController.getFilters);
router.get('/featured', partnerController.getFeatured);
router.get('/:id/reviews', partnerController.getReviews);
router.get('/:id/ratings', partnerController.getRatings);

router.get('/', authMiddleware, partnerController.getAll);
router.get('/:id', authMiddleware, partnerController.getById);
router.get('/:id/availability', authMiddleware, partnerController.checkAvailability);

module.exports = router;
*/