const express = require('express');
const router = express.Router();
const relationshipController = require('../controllers/relationshipController');

router.post('/', relationshipController.createRelationship);
router.get('/', relationshipController.getItems);
router.post('/:id', relationshipController.updateRelationship);
router.delete('/:id', relationshipController.deleteRelationship);

module.exports = router;

