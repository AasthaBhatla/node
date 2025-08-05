const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController'); 


router.post('/requests', requestController.insertRequest);
router.get('/my', requestController.getRequestsByUser);
router.get('/categories', requestController.getAllRequestCategories);
router.get('/:id', requestController.getRequestById);
router.put('/:id', requestController.updateRequestById);
router.put('/:id/status', requestController.updateStatus);
router.post('/assign', requestController.assignPartner);
router.post('/accept', requestController.acceptRequest);
router.post('/reject', requestController.rejectRequest);
router.delete('/:id', requestController.deleteRequest);

module.exports = router;
