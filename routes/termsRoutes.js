const express = require('express');
const termsRouter = express.Router();
const termsController = require('../controllers/termsController');
const authMiddleware = require('../middlewares/authMiddleware');

termsRouter.get('/taxonomy/:id/terms', termsController.getTermsByTaxonomyId);  
termsRouter.get('/:id', termsController.getTermById);                    
termsRouter.post('/', authMiddleware, termsController.create);          
termsRouter.post('/:id', authMiddleware, termsController.updateByTermId);      

module.exports = termsRouter;
