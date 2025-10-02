const express = require('express');
const router = express.Router();
const termsController = require('../controllers/termsController');

router.post('/', termsController.create);       
router.get('/:id', termsController.getById);      
router.post('/byTaxonomyIds', termsController.getByTaxonomyIds); 
router.post('/', termsController.updateByIds);     

module.exports = router;
