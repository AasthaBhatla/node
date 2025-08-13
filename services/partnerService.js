const pool = require('../db');

const ALL_PARTNER_ROLES = ['client', 'lawyer', 'expert', 'ngo', 'admin'];

const getAllPartners = async (searchQuery) => {
  try {
    let query = `
      SELECT id, email, phone, status, role, created_at
      FROM users
      WHERE role = 'client'
    `;
    const params = [];

    if (searchQuery) {
      params.push(`%${searchQuery}%`);
      query += ` AND (email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  } catch (err) {
    throw new Error('Error fetching partners');
  }
};

const getPartnerById = async (id) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.phone, u.status, u.role, 
             json_agg(json_build_object('key', um.key, 'value', um.value)) AS metadata
      FROM users u
      LEFT JOIN user_metadata um ON u.id = um.user_id
      WHERE u.role = 'client' AND u.id = $1
      GROUP BY u.id
    `, [id]);
    return rows[0];
  } catch (err) {
    throw new Error('Error fetching partner by ID');
  }
};

const getPartnerFilters = async (filters = {}) => {
  try {
    let filterConditions = '';
    let values = [];
    let paramIndex = 1;

    if (Object.keys(filters).length > 0) {
      const subConditions = [];

      for (const [key, value] of Object.entries(filters)) {
        subConditions.push(`
          user_id IN (
            SELECT user_id
            FROM user_metadata
            WHERE key = $${paramIndex} AND value ILIKE $${paramIndex + 1}
          )
        `);
        values.push(key, `%${value}%`);
        paramIndex += 2;
      }

      filterConditions = `AND ${subConditions.join(' AND ')}`;
    }

    const { rows } = await pool.query(
      `
      SELECT key, array_agg(DISTINCT value) AS values
      FROM user_metadata
      WHERE user_id IN (
          SELECT id FROM users WHERE role = 'client' ${filterConditions}
      )
      GROUP BY key
      `,
      values
    );

    return rows;
  } catch (err) {
    console.error(err);
    throw new Error('Error fetching partner filters');
  }
};

const checkPartnerAvailability = async (id) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.phone, u.role,
             json_agg(json_build_object('key', um.key, 'value', um.value)) AS metadata
      FROM users u
      LEFT JOIN user_metadata um ON u.id = um.user_id
      WHERE u.role = 'client' AND u.id = $1 AND um.key = 'availability'
      GROUP BY u.id
    `, [id]);
    return rows[0];
  } catch (err) {
    throw new Error('Error checking partner availability');
  }
};

const getPartnerReviews = async (id) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.phone, u.role,
             json_agg(json_build_object('key', um.key, 'value', um.value)) AS metadata
      FROM users u
      LEFT JOIN user_metadata um ON u.id = um.user_id
      WHERE u.role = ANY($1) AND u.id = $2 AND um.key = 'reviews'
      GROUP BY u.id
    `, [ALL_PARTNER_ROLES, id]);
    return rows[0];
  } catch (err) {
    throw new Error('Error fetching partner reviews');
  }
};

const getPartnerRatings = async (id) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.phone, u.role,
             json_agg(json_build_object('key', um.key, 'value', um.value)) AS metadata
      FROM users u
      LEFT JOIN user_metadata um ON u.id = um.user_id
      WHERE u.role = ANY($1) AND u.id = $2 AND um.key = 'ratings'
      GROUP BY u.id
    `, [ALL_PARTNER_ROLES, id]);
    return rows[0];
  } catch (err) {
    throw new Error('Error fetching partner ratings');
  }
};

const getFeaturedPartners = async () => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.phone, u.role,
             json_agg(json_build_object('key', um.key, 'value', um.value)) AS metadata
      FROM users u
      JOIN user_metadata um ON u.id = um.user_id
      WHERE u.role = ANY($1) AND um.key = 'featured' AND um.value = 'true'
      GROUP BY u.id
    `, [ALL_PARTNER_ROLES]);
    return rows;
  } catch (err) {
    throw new Error('Error fetching featured partners');
  }
};

module.exports = {
  getAllPartners,
  getPartnerById,
  getPartnerFilters,
  checkPartnerAvailability,
  getPartnerReviews,
  getPartnerRatings,
  getFeaturedPartners
};
