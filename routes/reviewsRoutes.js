const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewsController');
const authMiddleware = require('../middlewares/authMiddleware'); 

router.post('/', authMiddleware, reviewController.create);
router.get('/', authMiddleware, reviewController.getAll);
router.get('/:id', authMiddleware, reviewController.getById);
router.put('/:id', authMiddleware, reviewController.update);
router.delete('/:id', authMiddleware, reviewController.delete);

module.exports = router;
