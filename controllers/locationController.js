const { getAllLocations } = require('../services/locationService');

exports.getAll = async (req, res) => {
  try {
    const locations = await getAllLocations();
    res.json(locations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
