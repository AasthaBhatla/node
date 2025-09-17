const pool = require('../db');

const createOption = async (key, value) => {
  try {
    const result = await pool.query(
      `INSERT INTO options (key, value) VALUES ($1, $2) RETURNING *`,
      [key, value]
    );
    return result.rows[0];
  } catch (err) {
    throw err;
  }
};

const getOptions = async (keys) => {
  try {
    if (Array.isArray(keys) && keys.length > 0) {
      const result = await pool.query(
        `SELECT * FROM options WHERE key = ANY($1)`,
        [keys]
      );
      return result.rows;
    } else {
      const result = await pool.query(`SELECT * FROM options`);
      return result.rows;
    }
  } catch (err) {
    throw err;
  }
};

const updateOptions = async (updates) => {
  try {
    const results = [];
    for (const { key, value } of updates) {
      const result = await pool.query(
        `UPDATE options SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2 RETURNING *`,
        [value, key]
      );
      if (result.rows[0]) results.push(result.rows[0]);
    }
    return results;
  } catch (err) {
    throw err;
  }
};

const deleteOption = async (key) => {
  try {
    const result = await pool.query(
      `DELETE FROM options WHERE key = $1 RETURNING *`,
      [key]
    );
    return result.rows[0];
  } catch (err) {
    throw err;
  }
};

module.exports = {
  createOption,
  getOptions,
  updateOptions,
  deleteOption
};
