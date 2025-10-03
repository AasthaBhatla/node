const express = require('express');
const router = express.Router();
const termsController = require('../controllers/termsController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, termsController.create);
router.post('/', authMiddleware, termsController.updateByIds);
router.get('/:id', termsController.getById);
router.post('/byTaxonomyIds', termsController.getByTaxonomyIds);

module.exports = router;
