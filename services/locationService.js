const pool = require('../db');

const getAllLocations = async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM locations ORDER BY title ASC`
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getAllLocations:', err);
    throw new Error('Error fetching locations');
  }
};

module.exports = {
  getAllLocations,
};
