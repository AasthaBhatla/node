const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController'); 
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/', authMiddleware,requestController.insertRequest);
router.get('/my', authMiddleware,requestController.getRequestsByUser);
router.get('/categories', requestController.getAllRequestCategories);
router.get('/:id',requestController.getRequestById);
router.put('/:id',authMiddleware, requestController.updateRequestById);
router.put('/:id/status',authMiddleware, requestController.updateStatus);
router.post('/assign', authMiddleware,requestController.assignPartner);
router.post('/accept',authMiddleware, requestController.acceptRequest);
router.post('/reject',authMiddleware, requestController.rejectRequest);
router.delete('/:id',authMiddleware, requestController.deleteRequest);

module.exports = router;
