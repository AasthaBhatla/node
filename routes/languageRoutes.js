const express = require('express');
const router = express.Router();
const { getLanguages } = require('../controllers/languageController');

router.get('/languages', getLanguages);

module.exports = router;
