const express = require('express');
const router = express.Router();
const relationshipController = require('../controllers/relationshipController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/', relationshipController.createRelationship);
router.get('/', relationshipController.getItems);

router.post('/type-ids', authMiddleware, relationshipController.getTypeIds);

router.post('/:id', relationshipController.updateRelationship);
router.delete('/:id', relationshipController.deleteRelationship);

module.exports = router;

