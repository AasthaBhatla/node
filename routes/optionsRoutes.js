const express = require('express');
const router = express.Router();
const optionsController = require('../controllers/optionsController');

// router.post('/', optionsController.create);    
router.get('/', optionsController.get);          
// router.put('/', optionsController.update);      
// router.delete('/:key', optionsController.delete); 

module.exports = router;
