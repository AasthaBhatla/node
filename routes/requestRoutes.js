const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController'); 
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/assign', authMiddleware,requestController.assignPartner);
router.post('/accept',authMiddleware, requestController.acceptRequest);
router.post('/reject',authMiddleware, requestController.rejectRequest);

router.post('/', authMiddleware,requestController.insertRequest);
router.get('/me', authMiddleware,requestController.getRequestsByUser);
router.get('/categories', requestController.getAllRequestCategories);
router.get('/:id',authMiddleware,requestController.getRequestById);
router.post('/:id',authMiddleware, requestController.updateRequestById);
router.post('/:id/status',authMiddleware, requestController.updateStatus);
router.delete('/:id',authMiddleware, requestController.deleteRequest);

module.exports = router;
