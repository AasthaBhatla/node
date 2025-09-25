const pool = require('../db'); 

const createReview = async ({ reviewer_id, type, type_id, review, ratings }) => {
  const result = await pool.query(
    `INSERT INTO reviews (reviewer_id, type, type_id, review, ratings)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [reviewer_id, type, type_id, review, ratings]
  );
  return result.rows[0];
};

const getReviews = async (filters = {}) => {
  let query = 'SELECT * FROM reviews WHERE 1=1';
  const params = [];
  let count = 1;

  if (filters.type) {
    query += ` AND type = $${count++}`;
    params.push(filters.type);
  }

  if (filters.type_id) {
    query += ` AND type_id = $${count++}`;
    params.push(filters.type_id);
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query(query, params);
  return result.rows;
};

const getReviewById = async (id) => {
  const result = await pool.query('SELECT * FROM reviews WHERE id = $1', [id]);
  return result.rows[0];
};

const updateReview = async (id, { review, ratings }) => {
  const result = await pool.query(
    `UPDATE reviews SET review = $1, ratings = $2 WHERE id = $3 RETURNING *`,
    [review, ratings, id]
  );
  return result.rows[0];
};

const deleteReview = async (id) => {
  const result = await pool.query('DELETE FROM reviews WHERE id = $1', [id]);
  return result.rowCount;
};

module.exports = {
  createReview,
  getReviews,
  getReviewById,
  updateReview,
  deleteReview,
};
