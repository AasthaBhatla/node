const pool = require('../db');

const ALL_PARTNER_ROLES = ['lawyer', 'expert', 'ngo'];

const getAllPartners = async (authUser, searchQuery) => {
  if (authUser.role !== 'client') throw new Error('Unauthorized');

  const params = [ALL_PARTNER_ROLES];
  let query = `SELECT id, email, phone, status, role FROM users WHERE role = ANY($1)`;

  if (searchQuery) {
    params.push(`%${searchQuery}%`);
    query += ` AND (email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
  }

  query += ` ORDER BY id DESC`;

  const { rows } = await pool.query(query, params);
  return rows;
};

const getPartnerById = async (authUser, id) => {
  if (authUser.role !== 'client') throw new Error('Unauthorized');

  const { rows: userRows } = await pool.query(
    `SELECT id, email, phone, status, role FROM users WHERE role = ANY($1) AND id = $2`,
    [ALL_PARTNER_ROLES, id]
  );

  const user = userRows[0];
  if (!user) return null;

  const { rows: metadata } = await pool.query(
    `SELECT key, value FROM user_metadata WHERE user_id = $1`,
    [id]
  );

  user.metadata = metadata;
  return user;
};

const checkPartnerAvailability = async (authUser, id) => {
  if (authUser.role !== 'client') throw new Error('Unauthorized');

  const { rows } = await pool.query(
    `SELECT id, available, start_time, end_time 
     FROM user_availability 
     WHERE user_id = $1 
     ORDER BY start_time`,
    [id]
  );

  return rows;
};

const getPartnerReviews = async (id) => {
  const { rows } = await pool.query(
    `SELECT ur.id, ur.rating, ur.review, ur.created_at,
            json_build_object('id', r.id, 'email', r.email, 'role', r.role) AS reviewer
     FROM user_reviews ur
     JOIN users r ON ur.reviewer_id = r.id
     WHERE ur.reviewee_id = $1
     ORDER BY ur.created_at DESC`,
    [id]
  );

  return rows;
};

const getPartnerRatings = async (id) => {
  const { rows } = await pool.query(
    `SELECT AVG(rating)::numeric(10,2) AS average_rating, COUNT(*) AS total_reviews
     FROM user_reviews
     WHERE reviewee_id = $1`,
    [id]
  );

  return rows[0];
};

const getFeaturedPartners = async () => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.phone, u.role
     FROM users u
     JOIN user_metadata um ON u.id = um.user_id
     WHERE u.role = ANY($1) AND um.key = 'featured' AND um.value = 'true'`,
    [ALL_PARTNER_ROLES]
  );

  for (const partner of rows) {
    const { rows: metadata } = await pool.query(
      `SELECT key, value FROM user_metadata WHERE user_id = $1`,
      [partner.id]
    );
    partner.metadata = metadata;
  }

  return rows;
};

const getPartnerFilters = async (filters = {}) => {
  const params = [];
  let conditions = [];

  Object.entries(filters).forEach(([key, value]) => {
    params.push(key, `%${value}%`);
    conditions.push(`
      user_id IN (
        SELECT user_id
        FROM user_metadata
        WHERE key = $${params.length - 1} AND value ILIKE $${params.length}
      )
    `);
  });

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `
    SELECT key, array_agg(DISTINCT value) AS values
    FROM user_metadata
    WHERE user_id IN (
      SELECT id FROM users WHERE role = ANY($1)
    )
    ${whereClause}
    GROUP BY key
    `,
    [ALL_PARTNER_ROLES, ...params]
  );

  return rows;
};

module.exports = {
  getAllPartners,
  getPartnerById,
  checkPartnerAvailability,
  getPartnerReviews,
  getPartnerRatings,
  getFeaturedPartners,
  getPartnerFilters
};
