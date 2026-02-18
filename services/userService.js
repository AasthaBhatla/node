// services/userService.js
const pool = require("../db");

const normalizePhone = (phone) => {
  if (!phone) return null;
  phone = phone.replace(/\D/g, "");
  if (phone.startsWith("0")) phone = phone.slice(1);
  if (!phone.startsWith("91")) phone = "91" + phone;
  return "+" + phone;
};

const getUserByEmailOrPhone = async (email, phone) => {
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 OR phone = $2`,
      [email || null, phone || null],
    );
    return result.rows[0];
  } catch (err) {
    throw new Error("Error fetching user by email or phone");
  }
};

const insertUser = async (email, phone) => {
  try {
    const result = await pool.query(
      `INSERT INTO users (email, phone, status) VALUES ($1, $2, 'new') RETURNING *`,
      [email || null, phone || null],
    );
    return result.rows[0];
  } catch (err) {
    throw new Error("Error inserting new user");
  }
};

const setOtp = async (userId) => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query(`UPDATE users SET otp = $1 WHERE id = $2`, [otp, userId]);
    return otp;
  } catch (err) {
    throw new Error("Error setting OTP");
  }
};

const verifyOtp = async (userId, otp) => {
  try {
    const result = await pool.query(`SELECT otp FROM users WHERE id = $1`, [
      userId,
    ]);
    const user = result.rows[0];
    return user && user.otp === otp;
  } catch (err) {
    throw new Error("Error verifying OTP");
  }
};

const clearOtp = async (userId) => {
  try {
    await pool.query(`UPDATE users SET otp = NULL WHERE id = $1`, [userId]);
  } catch (err) {
    throw new Error("Error clearing OTP");
  }
};

const markUserAsRegistered = async (userId) => {
  try {
    await pool.query(`UPDATE users SET status = 'registered' WHERE id = $1`, [
      userId,
    ]);
  } catch (err) {
    throw new Error("Error marking user as registered");
  }
};

const updateUserMetadata = async (userId, metadata) => {
  try {
    for (const [key, value] of Object.entries(metadata)) {
      if (key === "role") continue;
      await pool.query(
        `INSERT INTO user_metadata (user_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [userId, key, value],
      );
    }
  } catch (err) {
    console.error("Error in updateUserMetadata:", err);
    throw new Error("Error updating user metadata");
  }
};

const getUserMetadata = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM user_metadata WHERE user_id = $1`,
      [userId],
    );
    const metadata = {};
    result.rows.forEach(({ key, value }) => {
      metadata[key] = value;
    });
    return metadata;
  } catch (err) {
    throw new Error("Error fetching user metadata");
  }
};

const updateUserRole = async (userId, role) => {
  try {
    await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [
      role,
      userId,
    ]);
  } catch (err) {
    console.error("Error in updateUserRole:", err);
    throw new Error("Error updating user role");
  }
};

const getUserById = async (userId) => {
  try {
    const userRes = await pool.query(
      `SELECT id, email, phone, status, role, created_at 
       FROM users 
       WHERE id = $1`,
      [userId],
    );

    if (userRes.rows.length === 0) return null;

    const user = userRes.rows[0];

    const metaRes = await pool.query(
      `SELECT key, value 
       FROM user_metadata 
       WHERE user_id = $1`,
      [userId],
    );

    const metadata = {};
    metaRes.rows.forEach(({ key, value }) => {
      metadata[key] = value;
    });

    const taxonomies = await getUserTaxonomies(userId);

    return {
      ...user,
      metadata,
      taxonomies,
    };
  } catch (err) {
    console.error("Error fetching user by ID:", err);
    throw new Error("Error fetching user by ID");
  }
};

const getUsers = async (filters = {}) => {
  const {
    termIds,
    role,
    status,
    count = 10,
    page = 1,
    orderBy = "created_at",
    order = "ASC",
    email,
    phone,
    metaQuery,
    search,
  } = filters;

  const values = [];
  let joins = "";
  const where = [];
  let i = 1;

  if (termIds !== undefined && termIds !== null) {
    const termArr = Array.isArray(termIds) ? termIds : [termIds];
    joins += ` JOIN taxonomy_relationships tr_filter ON tr_filter.type_id = u.id 
                AND tr_filter.type = 'user' 
                AND tr_filter.term_id = ANY($${i}::int[])`;
    values.push(termArr);
    i++;
  }
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
    const logic = metaQuery.relation?.toUpperCase() === "OR" ? "OR" : "AND";
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

  let orderClause = "u.created_at";
  if (orderBy === "name") {
    orderClause = `(SELECT value FROM user_metadata um_order WHERE um_order.user_id = u.id AND um_order.key = 'name')`;
  }

  const offset = (page - 1) * count;
  values.push(count, offset);

  const query = `
    SELECT DISTINCT u.id, u.email, u.phone, u.status, u.role, u.created_at
    FROM users u
    ${joins}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${orderClause} ${order.toUpperCase() === "DESC" ? "DESC" : "ASC"}
    LIMIT $${i++} OFFSET $${i++};
  `;

  const result = await pool.query(query, values);
  const users = result.rows;
  if (!users.length) return [];

  const userIds = users.map((u) => u.id);

  const metaResult = await pool.query(
    `SELECT user_id, key, value FROM user_metadata WHERE user_id = ANY($1::int[])`,
    [userIds],
  );

  const metadataMap = {};
  metaResult.rows.forEach(({ user_id, key, value }) => {
    if (!metadataMap[user_id]) metadataMap[user_id] = {};
    metadataMap[user_id][key] = value;
  });

  const taxoResult = await pool.query(
    `
    SELECT tr.type_id AS user_id, 
           tx.id AS taxonomy_id, tx.slug AS taxonomy_slug, tx.title AS taxonomy_title,
           t.id AS term_id, t.slug AS term_slug, t.title AS term_title, t.parent_id
    FROM taxonomy_relationships tr
    JOIN terms t ON tr.term_id = t.id
    JOIN taxonomy tx ON tr.taxonomy_id = tx.id
    WHERE tr.type = 'user' AND tr.type_id = ANY($1::int[])
    ORDER BY tr.type_id, tx.id, t.parent_id NULLS FIRST, t.id;
  `,
    [userIds],
  );

  const taxoMap = {};
  for (const row of taxoResult.rows) {
    if (!taxoMap[row.user_id]) taxoMap[row.user_id] = {};
    const userTax = taxoMap[row.user_id];

    if (!userTax[row.taxonomy_id]) {
      userTax[row.taxonomy_id] = {
        id: row.taxonomy_id,
        slug: row.taxonomy_slug,
        title: row.taxonomy_title,
        terms: [],
      };
    }

    userTax[row.taxonomy_id].terms.push({
      id: row.term_id,
      slug: row.term_slug,
      title: row.term_title,
      parent_id: row.parent_id,
    });
  }

  return users.map((user) => ({
    ...user,
    metadata: metadataMap[user.id] || {},
    taxonomies: taxoMap[user.id]
      ? Object.values(taxoMap[user.id]).map((tx) => ({
          ...tx,
          terms: buildHierarchy(tx.terms),
        }))
      : [],
  }));
};

const saveDeviceToken = async (
  userId,
  deviceToken,
  platform = null,
  deviceId = null,
) => {
  try {
    await pool.query(
      `INSERT INTO user_devices (user_id, device_token, platform, device_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (device_token)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     platform = EXCLUDED.platform,
                     device_id = EXCLUDED.device_id,
                     updated_at = NOW()`,
      [userId, deviceToken, platform, deviceId],
    );
  } catch (err) {
    console.error("Error saving device token:", err);
    throw new Error("Error saving device token");
  }
};

const removeDeviceToken = async (userId, deviceToken) => {
  try {
    const result = await pool.query(
      `DELETE FROM user_devices WHERE user_id = $1 AND device_token = $2`,
      [userId, deviceToken],
    );
    return result.rowCount;
  } catch (error) {
    console.error("Error removing device token:", error);
    throw new Error("Failed to remove device token");
  }
};

const getUserProfileById = async (userId, withMetadata = true) => {
  try {
    const userRes = await pool.query(
      `SELECT id, email, phone, status, role, created_at FROM users WHERE id = $1`,
      [userId],
    );

    if (userRes.rows.length === 0) return null;

    const user = userRes.rows[0];

    if (!withMetadata) return user;

    const metaRes = await pool.query(
      `SELECT key, value FROM user_metadata WHERE user_id = $1`,
      [userId],
    );

    const metadata = {};
    metaRes.rows.forEach(({ key, value }) => {
      metadata[key] = value;
    });

    return { ...user, metadata };
  } catch (err) {
    console.error(err);
    throw new Error("Error fetching user profile");
  }
};

const updateProfilePicUrl = async (userId, imageUrl) => {
  await pool.query(
    `INSERT INTO user_metadata (user_id, key, value)
     VALUES ($1, 'profile_pic_url', $2)
     ON CONFLICT (user_id, key)
     DO UPDATE SET value = EXCLUDED.value`,
    [userId, imageUrl],
  );
};

const addDocumentToMetadata = async (userId, newDoc) => {
  try {
    const res = await pool.query(
      `SELECT value FROM user_metadata WHERE user_id = $1 AND key = 'documents'`,
      [userId],
    );

    let docs = [];

    if (res.rows.length > 0) {
      const rawValue = res.rows[0].value;
      try {
        docs = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
        if (!Array.isArray(docs)) docs = [];
      } catch {
        docs = [];
      }
    }

    docs.push(newDoc);

    await pool.query(
      `INSERT INTO user_metadata (user_id, key, value)
       VALUES ($1, 'documents', $2)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [userId, JSON.stringify(docs)],
    );
  } catch (err) {
    console.error("Error in addDocumentToMetadata:", err);
    throw new Error("Failed to add document to metadata");
  }
};

const removeDocumentFromMetadata = async (userId, documentName) => {
  try {
    const result = await pool.query(
      `UPDATE user_metadata
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
      RETURNING *;`,
      [userId, documentName],
    );

    if (result.rowCount === 0) {
      throw new Error(
        "Document not found or user does not have documents metadata.",
      );
    }

    return result.rows[0];
  } catch (err) {
    console.error("Error in removeDocumentFromMetadata:", err);
    throw new Error("Error removing document from metadata");
  }
};

const getUserDocuments = async (userId) => {
  try {
    const result = await pool.query(
      "SELECT value FROM user_metadata WHERE user_id = $1 AND key = 'documents'",
      [userId],
    );
    if (result.rows.length === 0) return [];
    return JSON.parse(result.rows[0].value);
  } catch (err) {
    console.error("Error fetching user documents:", err);
    throw new Error("Error fetching user documents");
  }
};

const updateUser = async (userId, fields) => {
  const updates = [];
  const values = [];

  if (fields.email) {
    updates.push(`email = $${values.length + 1}`);
    values.push(fields.email.toLowerCase());
  }

  if (fields.phone) {
    const normalizedPhone = normalizePhone(fields.phone);
    updates.push(`phone = $${values.length + 1}`);
    values.push(normalizedPhone);
  }

  if (fields.status) {
    updates.push(`status = $${values.length + 1}`);
    values.push(fields.status.toLowerCase());
  }

  if (fields.role) {
    updates.push(`role = $${values.length + 1}`);
    values.push(fields.role.toLowerCase());
  }

  if (updates.length === 0) return;

  values.push(userId);
  const query = `UPDATE users SET ${updates.join(", ")} WHERE id = $${
    values.length
  } RETURNING id, email, phone, status, role`;

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (err) {
    console.error("Error updating user:", err);
    throw new Error("Error updating user");
  }
};

const updateUserLanguage = async (userId, languageId) => {
  try {
    const lang = await pool.query(`SELECT id FROM languages WHERE id = $1`, [
      languageId,
    ]);
    if (lang.rowCount === 0) throw new Error("Invalid language_id");

    await pool.query(`UPDATE users SET language_id = $1 WHERE id = $2`, [
      languageId,
      userId,
    ]);
  } catch (err) {
    console.error("Error in updateUserLanguage:", err);
    throw new Error("Error updating user language");
  }
};

const addUserTerms = async (userId, termIds) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const termId of termIds) {
      const term = await client.query(
        `SELECT taxonomy_id FROM terms WHERE id = $1`,
        [termId],
      );
      if (term.rowCount === 0) continue;

      const taxonomy_id = term.rows[0].taxonomy_id;

      await client.query(
        `INSERT INTO taxonomy_relationships (term_id, taxonomy_id, type, type_id)
         VALUES ($1, $2, 'user', $3)
         ON CONFLICT DO NOTHING`,
        [termId, taxonomy_id, userId],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in addUserTerms:", err);
    throw new Error("Error adding terms");
  } finally {
    client.release();
  }
};

const removeUserTerms = async (userId, termIds) => {
  try {
    await pool.query(
      `DELETE FROM taxonomy_relationships
       WHERE type = 'user' AND type_id = $1 AND term_id = ANY($2)`,
      [userId, termIds],
    );
  } catch (err) {
    console.error("Error in removeUserTerms:", err);
    throw new Error("Error removing terms");
  }
};

const deleteUser = async (userId) => {
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id, email, phone`,
      [userId],
    );
    return result.rows[0];
  } catch (err) {
    console.error("Error deleting user:", err);
    throw new Error("Error deleting user");
  }
};
const getUsersByTermIds = async (termIds = [], roles = null) => {
  if (!Array.isArray(termIds) || termIds.length === 0) return [];

  const params = [termIds];
  let paramIndex = 2;

  let query = `
    SELECT 
      u.id,
      u.email,
      u.phone,
      u.role,
      u.status,
      u.created_at,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', t.id, 'slug', t.slug, 'title', t.title))
        FILTER (WHERE t.id IS NOT NULL), '[]'
      ) AS terms,
      COALESCE(
        json_object_agg(um.key, um.value)
        FILTER (WHERE um.key IS NOT NULL), '{}'
      ) AS metadata
    FROM users u
    JOIN taxonomy_relationships tr 
      ON tr.type_id = u.id 
     AND tr.type = 'user' 
     AND tr.term_id = ANY($1::int[])
    LEFT JOIN terms t ON t.id = tr.term_id
    LEFT JOIN user_metadata um ON um.user_id = u.id
  `;

  if (roles && Array.isArray(roles) && roles.length > 0) {
    query += ` WHERE u.role = ANY($${paramIndex}::text[])`;
    params.push(roles);
    paramIndex++;
  } else if (roles && !Array.isArray(roles)) {
    query += ` WHERE u.role = $${paramIndex}`;
    params.push(roles);
    paramIndex++;
  }

  query += `
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `;

  const { rows } = await pool.query(query, params);

  if (!rows.length) return [];

  const users = rows.map((u) => ({
    ...u,
    terms: u.terms || [],
    metadata: u.metadata || {},
  }));
  const userIds = users.map((u) => u.id);

  const taxoQuery = `
    SELECT tr.type_id AS user_id,
           tx.id AS taxonomy_id, tx.slug AS taxonomy_slug, tx.title AS taxonomy_title,
           t.id AS term_id, t.slug AS term_slug, t.title AS term_title, t.parent_id
    FROM taxonomy_relationships tr
    JOIN terms t ON tr.term_id = t.id
    JOIN taxonomy tx ON tr.taxonomy_id = tx.id
    WHERE tr.type = 'user' AND tr.type_id = ANY($1::int[])
    ORDER BY tr.type_id, tx.id, t.parent_id NULLS FIRST, t.id;
  `;

  const taxoResult = await pool.query(taxoQuery, [userIds]);

  const taxoMap = {};
  for (const row of taxoResult.rows) {
    if (!taxoMap[row.user_id]) taxoMap[row.user_id] = {};
    const userTax = taxoMap[row.user_id];

    if (!userTax[row.taxonomy_id]) {
      userTax[row.taxonomy_id] = {
        id: row.taxonomy_id,
        slug: row.taxonomy_slug,
        title: row.taxonomy_title,
        terms: [],
      };
    }

    userTax[row.taxonomy_id].terms.push({
      id: row.term_id,
      slug: row.term_slug,
      title: row.term_title,
      parent_id: row.parent_id,
    });
  }

  return users.map((user) => ({
    ...user,
    taxonomies: taxoMap[user.id]
      ? Object.values(taxoMap[user.id]).map((tx) => ({
          ...tx,
          terms: buildHierarchy(tx.terms),
        }))
      : [],
  }));
};

const buildHierarchy = (terms) => {
  const map = {};
  const roots = [];

  terms.forEach((t) => (map[t.id] = { ...t, children: [] }));

  terms.forEach((t) => {
    if (t.parent_id && map[t.parent_id]) {
      map[t.parent_id].children.push(map[t.id]);
    } else {
      roots.push(map[t.id]);
    }
  });

  return roots;
};

const getUserTaxonomies = async (userId) => {
  const { rows } = await pool.query(
    `
    SELECT 
      tx.id AS taxonomy_id, tx.slug AS taxonomy_slug, tx.title AS taxonomy_title,
      t.id AS term_id, t.slug AS term_slug, t.title AS term_title, t.parent_id
    FROM taxonomy_relationships tr
    JOIN terms t ON tr.term_id = t.id
    JOIN taxonomy tx ON tr.taxonomy_id = tx.id
    WHERE tr.type = 'user' AND tr.type_id = $1
    ORDER BY tx.id, t.parent_id NULLS FIRST, t.id;
  `,
    [userId],
  );

  if (!rows.length) return [];

  const taxonomies = {};
  for (const row of rows) {
    if (!taxonomies[row.taxonomy_id]) {
      taxonomies[row.taxonomy_id] = {
        id: row.taxonomy_id,
        slug: row.taxonomy_slug,
        title: row.taxonomy_title,
        terms: [],
      };
    }
    taxonomies[row.taxonomy_id].terms.push({
      id: row.term_id,
      slug: row.term_slug,
      title: row.term_title,
      parent_id: row.parent_id,
    });
  }

  return Object.values(taxonomies).map((tx) => ({
    ...tx,
    terms: buildHierarchy(tx.terms),
  }));
};
const searchUsers = async (keyword, page = 1, limit = 10) => {
  if (!keyword || typeof keyword !== "string")
    return { users: [], page: 1, limit: 10, total: 0 };

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);
  const offset = (safePage - 1) * safeLimit;
  const ilike = `%${keyword}%`;

  const whereClause = `
    (
      u.email ILIKE $1
      OR u.phone ILIKE $1
      OR u.role::text ILIKE $1
      OR u.status::text ILIKE $1
      OR EXISTS (
        SELECT 1 FROM user_metadata um2
        WHERE um2.user_id = u.id AND um2.value ILIKE $1
      )
      OR EXISTS (
        SELECT 1
        FROM taxonomy_relationships tr2
        JOIN terms t2 ON t2.id = tr2.term_id
        WHERE tr2.type = 'user' AND tr2.type_id = u.id
          AND (t2.title ILIKE $1 OR t2.slug ILIKE $1)
      )
    )
  `;

  const countQuery = `SELECT COUNT(DISTINCT u.id) AS total FROM users u WHERE ${whereClause};`;

  const userQuery = `
    SELECT DISTINCT u.id, u.email, u.phone, u.role, u.status, u.created_at
    FROM users u
    WHERE ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT $2 OFFSET $3;
  `;

  try {
    const countRes = await pool.query(countQuery, [ilike]);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const userRes = await pool.query(userQuery, [ilike, safeLimit, offset]);
    const users = userRes.rows;
    if (!users || users.length === 0) {
      return { users: [], page: safePage, limit: safeLimit, total };
    }

    const userIds = users.map((u) => u.id);

    const metaRes = await pool.query(
      `SELECT user_id, key, value FROM user_metadata WHERE user_id = ANY($1::int[])`,
      [userIds],
    );
    const metadataMap = {};
    metaRes.rows.forEach(({ user_id, key, value }) => {
      if (!metadataMap[user_id]) metadataMap[user_id] = {};
      metadataMap[user_id][key] = value;
    });

    const taxoRes = await pool.query(
      `
      SELECT tr.type_id AS user_id,
             tx.id AS taxonomy_id, tx.slug AS taxonomy_slug, tx.title AS taxonomy_title,
             t.id AS term_id, t.slug AS term_slug, t.title AS term_title, t.parent_id
      FROM taxonomy_relationships tr
      JOIN terms t ON tr.term_id = t.id
      JOIN taxonomy tx ON tr.taxonomy_id = tx.id
      WHERE tr.type = 'user' AND tr.type_id = ANY($1::int[])
      ORDER BY tr.type_id, tx.id, t.parent_id NULLS FIRST, t.id;
    `,
      [userIds],
    );

    const taxoMap = {};
    for (const row of taxoRes.rows) {
      if (!taxoMap[row.user_id]) taxoMap[row.user_id] = {};
      const userTax = taxoMap[row.user_id];
      if (!userTax[row.taxonomy_id]) {
        userTax[row.taxonomy_id] = {
          id: row.taxonomy_id,
          slug: row.taxonomy_slug,
          title: row.taxonomy_title,
          terms: [],
        };
      }
      userTax[row.taxonomy_id].terms.push({
        id: row.term_id,
        slug: row.term_slug,
        title: row.term_title,
        parent_id: row.parent_id,
      });
    }
    const buildHierarchyLocal = (terms) => {
      const map = {};
      const roots = [];
      terms.forEach((t) => (map[t.id] = { ...t, children: [] }));
      terms.forEach((t) => {
        if (t.parent_id && map[t.parent_id]) {
          map[t.parent_id].children.push(map[t.id]);
        } else {
          roots.push(map[t.id]);
        }
      });
      return roots;
    };

    const finalUsers = users.map((user) => ({
      ...user,
      metadata: metadataMap[user.id] || {},
      taxonomies: taxoMap[user.id]
        ? Object.values(taxoMap[user.id]).map((tx) => ({
            ...tx,
            terms: buildHierarchyLocal(tx.terms),
          }))
        : [],
    }));

    return { users: finalUsers, page: safePage, limit: safeLimit, total };
  } catch (err) {
    console.error("Error in searchUsers (final):", err);
    throw new Error("Error searching users");
  }
};

// PUBLIC META KEYS WHITELIST (developer-editable)
// ✅ Only these metadata keys will be:
// - returned in response
// - used in keyword search
// - allowed in metaFilters
const PUBLIC_META_KEYS = new Set([
  "name",
  "display_name",
  "bio",
  "about",
  "gender",
  "city",
  "state",
  "country",
  "profile_pic_url",
  "experience",
  "languages",
  "first_name",
  "last_name",
  "dob",
  "gender",
  "call_charge",
  "free_calls",
  "experience",
  "rating",
  "cover_image_url",
  "is_online",
  "available_time",
  "available_days",
  "bookmark_user_ids",
  "free_messages",
  "message_charge",
  "bio",
  // add more safe keys here...
]);

const findUsersPublic = async ({
  keyword,
  page = 1,
  limit = 10,
  user_types = [],
  taxonomyFilters = [],
  taxonomyRelation = "AND",
  metaFilters = [],
  metaRelation = "AND",
} = {}) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimitRaw = Math.max(1, parseInt(limit, 10) || 10);
  const safeLimit = Math.min(safeLimitRaw, 50); // hard cap for public endpoint
  const offset = (safePage - 1) * safeLimit;

  // Public visibility rules
  const allowedStatuses = ["registered", "verified"];

  // roles: allow all except admin (and enforce even if caller sends it)
  const roleList = Array.isArray(user_types) ? user_types : [];
  const rolesFiltered = roleList
    .map((r) =>
      String(r || "")
        .toLowerCase()
        .trim(),
    )
    .filter(Boolean)
    .filter((r) => r !== "admin");

  // Keyword search: do NOT include email/phone; do include:
  // - role/status
  // - PUBLIC meta values
  // - term title/slug
  const hasKeyword = typeof keyword === "string" && keyword.trim() !== "";
  const ilike = hasKeyword ? `%${keyword.trim()}%` : null;

  // Build dynamic SQL
  const whereParts = [];
  const values = [];
  let i = 1;

  // Status filter (public)
  whereParts.push(`u.status = ANY($${i}::user_status[])`);
  values.push(allowedStatuses);
  i++;

  // Role filter (public) — optional
  // If user_types provided, apply it; always exclude admin
  whereParts.push(`(u.role IS NULL OR LOWER(u.role) <> 'admin')`);
  if (rolesFiltered.length) {
    whereParts.push(`LOWER(u.role) = ANY($${i}::text[])`);
    values.push(rolesFiltered);
    i++;
  }

  // Taxonomy filters (structure B)
  // taxonomyFilters: [{taxonomy_id, term_ids:[...]}]
  // relation: AND/OR
  if (Array.isArray(taxonomyFilters) && taxonomyFilters.length) {
    const cleaned = taxonomyFilters
      .map((f) => ({
        taxonomy_id: parseInt(f.taxonomy_id, 10),
        term_ids: Array.isArray(f.term_ids)
          ? f.term_ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
          : [],
      }))
      .filter((f) => Number.isFinite(f.taxonomy_id) && f.term_ids.length);

    if (cleaned.length) {
      const rel =
        String(taxonomyRelation || "AND").toUpperCase() === "OR" ? "OR" : "AND";

      if (rel === "AND") {
        // must satisfy each group
        for (const g of cleaned) {
          whereParts.push(`
            EXISTS (
              SELECT 1
              FROM taxonomy_relationships trf
              WHERE trf.type = 'user'
                AND trf.type_id = u.id
                AND trf.taxonomy_id = $${i}
                AND trf.term_id = ANY($${i + 1}::int[])
            )
          `);
          values.push(g.taxonomy_id, g.term_ids);
          i += 2;
        }
      } else {
        // OR across groups
        const orBlocks = [];
        for (const g of cleaned) {
          orBlocks.push(`
            EXISTS (
              SELECT 1
              FROM taxonomy_relationships trf
              WHERE trf.type = 'user'
                AND trf.type_id = u.id
                AND trf.taxonomy_id = $${i}
                AND trf.term_id = ANY($${i + 1}::int[])
            )
          `);
          values.push(g.taxonomy_id, g.term_ids);
          i += 2;
        }
        whereParts.push(`(${orBlocks.join(" OR ")})`);
      }
    }
  }

  // Metadata filters (like taxonomies, but on user_metadata)
  // metaFilters: [{key, op, value}]
  // metaRelation: AND/OR
  if (Array.isArray(metaFilters) && metaFilters.length) {
    const cleaned = metaFilters
      .map((f) => ({
        key: String(f.key || "").trim(),
        op: String(f.op || "eq").toLowerCase(),
        value: f.value,
      }))
      .filter((f) => f.key && PUBLIC_META_KEYS.has(f.key)); // ✅ only allow whitelisted keys

    if (cleaned.length) {
      const rel =
        String(metaRelation || "AND").toUpperCase() === "OR" ? "OR" : "AND";
      const blocks = [];

      for (const f of cleaned) {
        if (f.op === "exists") {
          blocks.push(`
            EXISTS (
              SELECT 1 FROM user_metadata umf
              WHERE umf.user_id = u.id AND umf.key = $${i}
            )
          `);
          values.push(f.key);
          i += 1;
          continue;
        }

        if (f.op === "in") {
          const arr = Array.isArray(f.value)
            ? f.value.map((v) => String(v))
            : [];
          if (!arr.length) continue;

          blocks.push(`
            EXISTS (
              SELECT 1 FROM user_metadata umf
              WHERE umf.user_id = u.id
                AND umf.key = $${i}
                AND umf.value = ANY($${i + 1}::text[])
            )
          `);
          values.push(f.key, arr);
          i += 2;
          continue;
        }

        if (f.op === "ilike") {
          const v = `%${String(f.value ?? "").trim()}%`;
          if (v === "%%") continue;

          blocks.push(`
            EXISTS (
              SELECT 1 FROM user_metadata umf
              WHERE umf.user_id = u.id
                AND umf.key = $${i}
                AND umf.value ILIKE $${i + 1}
            )
          `);
          values.push(f.key, v);
          i += 2;
          continue;
        }

        // default: eq
        const v = String(f.value ?? "");
        blocks.push(`
          EXISTS (
            SELECT 1 FROM user_metadata umf
            WHERE umf.user_id = u.id
              AND umf.key = $${i}
              AND umf.value = $${i + 1}
          )
        `);
        values.push(f.key, v);
        i += 2;
      }

      if (blocks.length) {
        whereParts.push(`(${blocks.join(` ${rel} `)})`);
      }
    }
  }

  // Keyword block (optional)
  if (hasKeyword) {
    // Search in public meta values only (whitelisted keys), role/status, and term title/slug
    const publicMetaKeysArr = Array.from(PUBLIC_META_KEYS);

    whereParts.push(`
      (
        u.role::text ILIKE $${i}
        OR u.status::text ILIKE $${i}
        OR EXISTS (
          SELECT 1 FROM user_metadata umk
          WHERE umk.user_id = u.id
            AND umk.key = ANY($${i + 1}::text[])
            AND umk.value ILIKE $${i}
        )
        OR EXISTS (
          SELECT 1
          FROM taxonomy_relationships trk
          JOIN terms tk ON tk.id = trk.term_id
          WHERE trk.type = 'user' AND trk.type_id = u.id
            AND (tk.title ILIKE $${i} OR tk.slug ILIKE $${i})
        )
      )
    `);

    values.push(ilike, publicMetaKeysArr);
    i += 2;
  }

  const whereClause = whereParts.length
    ? `WHERE ${whereParts.join(" AND ")}`
    : "";

  const countQuery = `
    SELECT COUNT(DISTINCT u.id) AS total
    FROM users u
    ${whereClause};
  `;

  const usersQuery = `
    SELECT DISTINCT
      u.id,
      u.role,
      u.status,
      u.created_at,
      u.language_id,
      u.location_id
    FROM users u
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT $${i} OFFSET $${i + 1};
  `;

  try {
    const countRes = await pool.query(countQuery, values);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const listRes = await pool.query(usersQuery, [
      ...values,
      safeLimit,
      offset,
    ]);
    const users = listRes.rows || [];
    if (!users.length)
      return { users: [], page: safePage, limit: safeLimit, total };

    const userIds = users.map((u) => u.id);

    // Fetch metadata (ONLY whitelisted keys)
    const metaKeysArr = Array.from(PUBLIC_META_KEYS);
    const metaRes = await pool.query(
      `SELECT user_id, key, value
       FROM user_metadata
       WHERE user_id = ANY($1::int[])
         AND key = ANY($2::text[])`,
      [userIds, metaKeysArr],
    );

    const metadataMap = {};
    for (const { user_id, key, value } of metaRes.rows) {
      if (!metadataMap[user_id]) metadataMap[user_id] = {};
      metadataMap[user_id][key] = value;
    }

    // Fetch taxonomies + terms
    const taxoRes = await pool.query(
      `
      SELECT tr.type_id AS user_id,
             tx.id AS taxonomy_id, tx.slug AS taxonomy_slug, tx.title AS taxonomy_title,
             t.id AS term_id, t.slug AS term_slug, t.title AS term_title, t.parent_id
      FROM taxonomy_relationships tr
      JOIN terms t ON tr.term_id = t.id
      JOIN taxonomy tx ON tr.taxonomy_id = tx.id
      WHERE tr.type = 'user' AND tr.type_id = ANY($1::int[])
      ORDER BY tr.type_id, tx.id, t.parent_id NULLS FIRST, t.id;
    `,
      [userIds],
    );

    const taxoMap = {};
    for (const row of taxoRes.rows) {
      if (!taxoMap[row.user_id]) taxoMap[row.user_id] = {};
      const userTax = taxoMap[row.user_id];

      if (!userTax[row.taxonomy_id]) {
        userTax[row.taxonomy_id] = {
          id: row.taxonomy_id,
          slug: row.taxonomy_slug,
          title: row.taxonomy_title,
          terms: [],
        };
      }

      userTax[row.taxonomy_id].terms.push({
        id: row.term_id,
        slug: row.term_slug,
        title: row.term_title,
        parent_id: row.parent_id,
      });
    }

    // local hierarchy builder
    const buildHierarchyLocal = (terms) => {
      const map = {};
      const roots = [];
      terms.forEach((t) => (map[t.id] = { ...t, children: [] }));
      terms.forEach((t) => {
        if (t.parent_id && map[t.parent_id])
          map[t.parent_id].children.push(map[t.id]);
        else roots.push(map[t.id]);
      });
      return roots;
    };

    const finalUsers = users.map((u) => ({
      ...u,
      metadata: metadataMap[u.id] || {},
      taxonomies: taxoMap[u.id]
        ? Object.values(taxoMap[u.id]).map((tx) => ({
            ...tx,
            terms: buildHierarchyLocal(tx.terms),
          }))
        : [],
    }));

    return { users: finalUsers, page: safePage, limit: safeLimit, total };
  } catch (err) {
    console.error("Error in findUsersPublic:", err);
    throw new Error("Error finding users");
  }
};

const getUsersByIds = async (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  try {
    const usersRes = await pool.query(
      `SELECT id, email, phone, role, status, created_at 
       FROM users 
       WHERE id = ANY($1::int[])`,
      [ids],
    );

    const users = usersRes.rows;
    if (users.length === 0) return [];

    const userIds = users.map((u) => u.id);

    const metaRes = await pool.query(
      `SELECT user_id, key, value 
       FROM user_metadata 
       WHERE user_id = ANY($1::int[])`,
      [userIds],
    );

    const metadataMap = {};
    metaRes.rows.forEach(({ user_id, key, value }) => {
      if (!metadataMap[user_id]) metadataMap[user_id] = {};
      metadataMap[user_id][key] = value;
    });

    const taxoRes = await pool.query(
      `
      SELECT tr.type_id AS user_id,
             tx.id AS taxonomy_id, tx.slug AS taxonomy_slug, tx.title AS taxonomy_title,
             t.id AS term_id, t.slug AS term_slug, t.title AS term_title, t.parent_id
      FROM taxonomy_relationships tr
      JOIN terms t ON t.id = tr.term_id
      JOIN taxonomy tx ON tr.taxonomy_id = tx.id
      WHERE tr.type = 'user' AND tr.type_id = ANY($1::int[])
      ORDER BY tr.type_id, tx.id, t.parent_id NULLS FIRST, t.id;
      `,
      [userIds],
    );

    const taxoMap = {};
    for (const row of taxoRes.rows) {
      if (!taxoMap[row.user_id]) taxoMap[row.user_id] = {};
      const userTax = taxoMap[row.user_id];

      if (!userTax[row.taxonomy_id]) {
        userTax[row.taxonomy_id] = {
          id: row.taxonomy_id,
          slug: row.taxonomy_slug,
          title: row.taxonomy_title,
          terms: [],
        };
      }

      userTax[row.taxonomy_id].terms.push({
        id: row.term_id,
        slug: row.term_slug,
        title: row.term_title,
        parent_id: row.parent_id,
      });
    }

    return users.map((user) => ({
      ...user,
      metadata: metadataMap[user.id] || {},
      taxonomies: taxoMap[user.id]
        ? Object.values(taxoMap[user.id]).map((tx) => ({
            ...tx,
            terms: buildHierarchy(tx.terms),
          }))
        : [],
    }));
  } catch (error) {
    console.error("Error in getUsersByIds:", error);
    throw new Error("Error fetching multiple users by ID");
  }
};

const getUserDeviceTokens = async (userId) => {
  const { rows } = await pool.query(
    `SELECT device_token FROM user_devices WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.device_token);
};

const getTokensByUserIds = async (userIds = []) => {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT device_token
     FROM user_devices
     WHERE user_id = ANY($1::int[])`,
    [userIds],
  );
  return rows.map((r) => r.device_token);
};

const getUserCardsByIds = async (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const usersRes = await pool.query(
    `SELECT id, role, status, created_at
     FROM users
     WHERE id = ANY($1::int[])`,
    [ids],
  );

  const users = usersRes.rows || [];
  if (!users.length) return [];

  const userIds = users.map((u) => u.id);

  const metaRes = await pool.query(
    `SELECT user_id, key, value
     FROM user_metadata
     WHERE user_id = ANY($1::int[])`,
    [userIds],
  );

  const metaMap = {};
  for (const row of metaRes.rows) {
    if (!metaMap[row.user_id]) metaMap[row.user_id] = {};
    metaMap[row.user_id][row.key] = row.value;
  }

  return users.map((u) => ({
    ...u,
    metadata: metaMap[u.id] || {},
  }));
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
  getUserDocuments,
  updateUser,
  removeDocumentFromMetadata,
  updateUserLanguage,
  addUserTerms,
  removeUserTerms,
  deleteUser,
  getUsersByTermIds,
  buildHierarchy,
  getUserTaxonomies,
  searchUsers,
  getUsersByIds,
  findUsersPublic,
  getUserDeviceTokens,
  getTokensByUserIds,
  getUserCardsByIds,
};
