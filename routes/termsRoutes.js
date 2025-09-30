const express = require('express');
const termsRouter = express.Router();
const termsController = require('../controllers/termsController');
const authMiddleware = require('../middlewares/authMiddleware');

termsRouter.post('/taxonomy/terms', termsController.getByTaxonomyIds);
termsRouter.post('/ids', termsController.getByIds);
termsRouter.post('/', authMiddleware, termsController.create);
termsRouter.put('/', authMiddleware, termsController.updateByIds);

module.exports = termsRouter;
