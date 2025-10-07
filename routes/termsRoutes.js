const express = require('express');
const router = express.Router();
const termsController = require('../controllers/termsController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, termsController.create);
router.post('/update', authMiddleware, termsController.update);
router.get('/:id', termsController.getById);
router.post('/byTaxonomyIds', termsController.getByTaxonomyIds);
router.get('/slug/:slug/terms',termsController.getTermsBySlug);

module.exports = router;
