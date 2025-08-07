const express = require('express');
const taxonomyRouter = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const taxonomyController = require('../controllers/taxonomyController');

taxonomyRouter.get('/', taxonomyController.getAll);
taxonomyRouter.get('/:id', taxonomyController.getById);
taxonomyRouter.post('/', authMiddleware, taxonomyController.create);
taxonomyRouter.post('/:id', authMiddleware, taxonomyController.update);
module.exports = taxonomyRouter;
