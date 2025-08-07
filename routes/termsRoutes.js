const express = require('express');
const termsRouter = express.Router();
const termsController = require('../controllers/termsController');
const authMiddleware = require('../middlewares/authMiddleware');

termsRouter.get('/taxonomy/:id/terms', termsController.getTermsByTaxonomyId);  
termsRouter.get('/terms/:id', termsController.getTermById);                    
termsRouter.post('/terms', authMiddleware, termsController.create);          
termsRouter.post('/terms/:id', authMiddleware, termsController.update);      

module.exports = termsRouter;
