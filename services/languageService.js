const pool = require('../db');


const getAllLanguages = async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM languages ORDER BY title ASC`
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getAllLanguages:', err);
    throw new Error('Error fetching languages');
  }
};

module.exports = {
  getAllLanguages,
};
