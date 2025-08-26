const { getAllLanguages } = require('../services/languageService');

exports.getLanguages = async (req, res) => {
  try {
    const languages = await getAllLanguages();
    res.json(languages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
