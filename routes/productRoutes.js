const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

router.post('/', productController.create);       
router.get('/', productController.getAll);         
router.get('/:id', productController.getById);     
router.post('/:id', productController.update);      
router.delete('/:id', productController.delete);   

module.exports = router;
