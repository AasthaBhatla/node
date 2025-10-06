const express = require('express');
const router = express.Router();
const reviewsController = require('../controllers/reviewsController');
const authMiddleware = require('../middlewares/authMiddleware'); 

router.post('/', authMiddleware, reviewsController.create);
router.get('/', reviewsController.getAll);
router.get('/:id', reviewsController.getById);
router.post('/:id', authMiddleware, reviewsController.update);
router.delete('/:id', authMiddleware, reviewsController.remove);

module.exports = router;
