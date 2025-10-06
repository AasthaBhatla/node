const pool = require('../db');

// ✅ Create Review
const createReview = async (reviewer_id, type, type_id, review, ratings, metadata = {}) => {
  try {
    // Insert main review
    const result = await pool.query(
      `INSERT INTO reviews (reviewer_id, type, type_id, review, ratings)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [reviewer_id, type, type_id, review, ratings]
    );

    const newReview = result.rows[0];

    // Handle metadata (can be array or JSON)
    if (Array.isArray(metadata)) {
      for (const meta of metadata) {
        await pool.query(
          `INSERT INTO review_metadata (review_id, meta_key, meta_value)
           VALUES ($1, $2, $3)`,
          [newReview.id, meta.key, meta.value]
        );
      }
    } else if (typeof metadata === 'object' && metadata !== null) {
      for (const [key, value] of Object.entries(metadata)) {
        await pool.query(
          `INSERT INTO review_metadata (review_id, meta_key, meta_value)
           VALUES ($1, $2, $3)`,
          [newReview.id, key, value]
        );
      }
    }

    return newReview;
  } catch (err) {
    console.error('DB Error creating review:', err);
    throw err;
  }
};

// ✅ Get All Reviews (optional filters)
const getAllReviews = async (filters = {}) => {
  try {
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
  } catch (err) {
    console.error('DB Error fetching all reviews:', err);
    throw new Error('Error fetching all reviews');
  }
};

// ✅ Get Review by ID (with metadata)
const getReviewById = async (id) => {
  try {
    const reviewRes = await pool.query(`SELECT * FROM reviews WHERE id = $1`, [id]);
    if (reviewRes.rows.length === 0) return null;

    const review = reviewRes.rows[0];
    const metaRes = await pool.query(
      `SELECT meta_key, meta_value FROM review_metadata WHERE review_id = $1`,
      [id]
    );

    review.metadata = metaRes.rows.reduce((acc, row) => {
      acc[row.meta_key] = row.meta_value;
      return acc;
    }, {});

    return review;
  } catch (err) {
    console.error('DB Error fetching review by ID:', err);
    throw new Error('Error fetching review by ID');
  }
};

// ✅ Update Review (and metadata)
const updateReviewById = async (id, review, ratings, metadata = {}) => {
  try {
    const result = await pool.query(
      `UPDATE reviews SET review = $1, ratings = $2 WHERE id = $3 RETURNING *`,
      [review, ratings, id]
    );

    const updated = result.rows[0];
    if (!updated) return null;

    // Delete old metadata
    await pool.query(`DELETE FROM review_metadata WHERE review_id = $1`, [id]);

    // Insert new metadata
    if (Array.isArray(metadata)) {
      for (const meta of metadata) {
        await pool.query(
          `INSERT INTO review_metadata (review_id, meta_key, meta_value)
           VALUES ($1, $2, $3)`,
          [id, meta.key, meta.value]
        );
      }
    } else if (typeof metadata === 'object' && metadata !== null) {
      for (const [key, value] of Object.entries(metadata)) {
        await pool.query(
          `INSERT INTO review_metadata (review_id, meta_key, meta_value)
           VALUES ($1, $2, $3)`,
          [id, key, value]
        );
      }
    }

    return updated;
  } catch (err) {
    console.error('DB Error updating review:', err);
    throw new Error('Error updating review');
  }
};

// ✅ Delete Review
const deleteReviewById = async (id) => {
  try {
    const result = await pool.query(`DELETE FROM reviews WHERE id = $1 RETURNING *`, [id]);
    return result.rows[0];
  } catch (err) {
    console.error('DB Error deleting review:', err);
    throw new Error('Error deleting review');
  }
};

module.exports = {
  createReview,
  getAllReviews,
  getReviewById,
  updateReviewById,
  deleteReviewById,
};
