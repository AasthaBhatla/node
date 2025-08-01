const pool = require('../db');

const normalizePhone = (phone) => {
  if (!phone) return null;
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = phone.slice(1);
  if (!phone.startsWith('91')) phone = '91' + phone;
  return '+' + phone;
};

const getUserByEmailOrPhone = async (email, phone) => {
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 OR phone = $2`,
      [email || null, phone || null]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error fetching user by email or phone');
  }
};

const insertUser = async (email, phone) => {
  try {
    const result = await pool.query(
      `INSERT INTO users (email, phone, status) VALUES ($1, $2, 'new') RETURNING *`,
      [email || null, phone || null]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error inserting new user');
  }
};

const setOtp = async (userId) => {
  try {
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    await pool.query(`UPDATE users SET otp = $1 WHERE id = $2`, [otp, userId]);
    return otp;
  } catch (err) {
    throw new Error('Error setting OTP');
  }
};

const verifyOtp = async (userId, otp) => {
  try {
    const result = await pool.query(`SELECT otp FROM users WHERE id = $1`, [userId]);
    const user = result.rows[0];
    return user && user.otp === otp;
  } catch (err) {
    throw new Error('Error verifying OTP');
  }
};

const clearOtp = async (userId) => {
  try {
    await pool.query(`UPDATE users SET otp = NULL WHERE id = $1`, [userId]);
  } catch (err) {
    throw new Error('Error clearing OTP');
  }
};

// userService.js
const markUserAsRegistered = async (userId) => {
  console.log('Updating status for:', userId);
  try {
    const result = await pool.query(
      `UPDATE users SET status = 'registered' WHERE id = $1`,
      [userId]
    );
    console.log('Update result:', result.rowCount); // Should be 1
  } catch (err) {
    console.error('Error in markUserAsRegistered:', err);
    throw new Error('Error marking user as registered');
  }
};


const updateUserMetadata = async (userId, metadata) => {
  try {
    for (const [key, value] of Object.entries(metadata)) {
      if (key === 'role') continue;
      await pool.query(
        `INSERT INTO user_metadata (user_id, "key", value)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [userId, key, value]
      );
    }
  } catch (err) {
  console.error('Error in updateUserMetadata:', err);
  throw new Error('Error updating user metadata');
  }
};

const getUserMetadata = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT "key", value FROM user_metadata WHERE user_id = $1`,
      [userId]
    );
    const metadata = {};
    result.rows.forEach(({ key, value }) => {
      metadata[key] = value;
    });
    return metadata;
  } catch (err) {
    throw new Error('Error fetching user metadata');
  }
};

const updateUserRole = async (userId, role) => {
  try {
    await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [role, userId]);
  } catch (err) {
    console.error('Error in updateUserRole:', err);
    throw new Error('Error updating user role');
  }
};

const getUserById = async (userId) => {
  const result = await pool.query(
    `SELECT email, phone, status, role FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0];
};

const getUsers = async (filters = {}) => {
  const {
    role,
    status,
    count = 10,
    page = 1,
    orderBy = 'date',
    order = 'ASC',
    email,
    phone,
    metaQuery,
    search,
    withMetadata = false,
  } = filters;

  const values = [];
  let joins = '';
  const where = [];
  let i = 1;

  if (role) {
    where.push(`u.role = $${i++}`);
    values.push(role);
  }
  if (status) {
    where.push(`u.status = $${i++}`);
    values.push(status);
  }
  if (email) {
    where.push(`u.email = $${i++}`);
    values.push(email);
  }
  if (phone) {
    where.push(`u.phone = $${i++}`);
    values.push(phone);
  }

  if (metaQuery?.conditions?.length) {
    const logic = metaQuery.relation?.toUpperCase() === 'OR' ? 'OR' : 'AND';
    const metaConditions = [];

    metaQuery.conditions.forEach(({ key, value }, index) => {
      const alias = `um_meta_${index}`;
      joins += ` JOIN user_metadata ${alias} ON ${alias}.user_id = u.id AND ${alias}.key = $${i++} AND ${alias}.value = $${i++}`;
      values.push(key, value);
    });
  }

  if (search) {
    joins += ` JOIN user_metadata um_search ON um_search.user_id = u.id`;
    where.push(`LOWER(um_search.value) LIKE $${i++}`);
    values.push(`%${search.toLowerCase()}%`);
  }

  let orderClause = 'u.created_at';
  if (orderBy === 'name') {
    orderClause = `(SELECT value FROM user_metadata um_order WHERE um_order.user_id = u.id AND um_order.key = 'name')`;
  }

  const offset = (page - 1) * count;
  values.push(count, offset);

  const query = `
    SELECT DISTINCT u.id, u.email, u.phone, u.status, u.role, u.created_at
    FROM users u
    ${joins}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderClause} ${order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}
    LIMIT $${i++} OFFSET $${i++};
  `;

  try {
    const result = await pool.query(query, values);
    const users = result.rows;

    if (!withMetadata) return users;

    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return users;

    const metaResult = await pool.query(
      `SELECT user_id, key, value FROM user_metadata WHERE user_id = ANY($1::int[])`,
      [userIds]
    );

    const metadataMap = {};
    metaResult.rows.forEach(({ user_id, key, value }) => {
      if (!metadataMap[user_id]) metadataMap[user_id] = {};
      metadataMap[user_id][key] = value;
    });

    return users.map((user) => ({
      ...user,
      metadata: metadataMap[user.id] || {},
    }));
  } catch (err) {
    console.error(err);
    throw new Error('Error fetching users');
  }
};

const saveDeviceToken = async (userId, deviceToken) => {
  try {
    await pool.query(
      `INSERT INTO user_devices (user_id, device_token)
       VALUES ($1, $2)
       ON CONFLICT (user_id, device_token) DO NOTHING`,
      [userId, deviceToken]
    );
  } catch (err) {
    throw new Error('Error saving device token');
  }
};
const removeDeviceToken = async (userId, deviceToken) => {
  try {
    await pool.query(
  `DELETE FROM user_devices WHERE user_id = $1 AND device_token = $2`,
  [userId, deviceToken]
);

  } catch (error) {
    console.error('Error removing device token:', error);
    throw new Error('Failed to remove device token');
  }
};
const getUserProfileById = async (userId, withMetadata = true) => {
  try {
    const userRes = await pool.query(
    `SELECT id, email, phone, status, role, created_at FROM users WHERE id = $1`,
     [userId]
     );
   if (userRes.rows.length === 0) return null;

    const user = userRes.rows[0];

    if (!withMetadata) return user;

    const metaRes = await pool.query(
    `SELECT key, value FROM user_metadata WHERE user_id = $1`,
    [userId]
    );

    const metadata = {};
    metaRes.rows.forEach(({ key, value }) => {
      metadata[key] = value;
    });

    return {
      ...user,
      metadata
    };
  } catch (err) {
    console.error(err);
    throw new Error('Error fetching user profile');
  }
};
const updateProfilePicUrl = async (userId, imageUrl) => {
  const query = `
  INSERT INTO user_metadata (user_id, key, value)
  VALUES ($1, 'profile_pic_url', $2)
  ON CONFLICT (user_id, key)
  DO UPDATE SET value = EXCLUDED.value
`;
  await pool.query(query, [userId, imageUrl]);
};

const addDocumentToMetadata = async (userId, newDoc) => {
  try {
    const res = await pool.query(
      `SELECT value FROM user_metadata WHERE user_id = $1 AND key = 'documents'`,
      [userId]
    );

    let docs = [];

    if (res.rows.length > 0) {
      const rawValue = res.rows[0].value;

      try {
        docs = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        if (!Array.isArray(docs)) {
          docs = [];
        }
      } catch (parseErr) {
        console.warn('Invalid documents metadata JSON, resetting to empty array');
        docs = [];
      }
    }

    docs.push(newDoc);

    await pool.query(
      `
      INSERT INTO user_metadata (user_id, key, value)
      VALUES ($1, 'documents', $2)
      ON CONFLICT (user_id, key)
      DO UPDATE SET value = EXCLUDED.value
      `,
      [userId, JSON.stringify(docs)]
    );

  } catch (err) {
    console.error('Error in addDocumentToMetadata:', err);
    throw new Error('Failed to update documents in metadata');
  }
};

const removeDocumentFromMetadata = async (userId, documentName) => {
  try {
    const result = await pool.query(
      `
      UPDATE user_metadata
      SET value = jsonb_set(
        value::jsonb,
        '{documents}',
        COALESCE(
          (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(
              (value::jsonb ->> 'documents')::jsonb
            ) elem
            WHERE elem->>'name' != $2
          ),
          '[]'::jsonb
        ),
        true
      )::text  -- cast back to text if your value column is text
      WHERE user_id = $1 AND key = 'documents'
      RETURNING *;
      `,
      [userId, documentName]
    );

    if (result.rowCount === 0) {
      throw new Error('Document not found or user does not have documents metadata.');
    }

    return result.rows[0];
  } catch (err) {
    console.error('Error in removeDocumentFromMetadata:', err);
    throw new Error('Error removing document from metadata');
  }
};
const getUserDocuments = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT value FROM user_metadata WHERE user_id = $1 AND key = 'documents'`,
      [userId]
    );
    if (result.rows.length === 0) return []
    return JSON.parse(result.rows[0].value);
  } catch (err) {
    console.error('Error fetching user documents:', err);
    throw new Error('Error fetching user documents');
  }
};


module.exports = {
  normalizePhone,
  getUserByEmailOrPhone,
  insertUser,
  setOtp,
  verifyOtp,
  clearOtp,
  markUserAsRegistered,
  updateUserMetadata,
  getUserMetadata,
  updateUserRole,
  getUserById,
  getUsers,
  saveDeviceToken,
  removeDeviceToken,
  getUserProfileById,
  updateProfilePicUrl,
  addDocumentToMetadata,
  removeDocumentFromMetadata,
  getUserDocuments
};
