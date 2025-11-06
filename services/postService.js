const pool = require("../db");

const createPost = async (postType, title, slug, authorId) => {
  const result = await pool.query(
    `INSERT INTO posts (post_type, title, slug, author_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [postType || "post", title, slug, authorId]
  );
  return result.rows[0];
};

const getPostById = async (id) => {
  const result = await pool.query(
    `SELECT p.*, u.email AS author_email
     FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const getPostBySlug = async (slug) => {
  const result = await pool.query(
    `SELECT p.*, u.email AS author_email
     FROM posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.slug = $1`,
    [slug]
  );
  return result.rows[0] || null;
};

const getAllPosts = async (
  offset = 0,
  limit = 10,
  postType = "post",
  termIds = [],
  metadataFilters = {},
  authorId = null
) => {
  let query = `
    SELECT 
      p.*, 
      u.email AS author_email,
      COALESCE(
        json_agg(json_build_object('key', pm.key, 'value', pm.value)) 
        FILTER (WHERE pm.id IS NOT NULL), '[]'
      ) AS metadata
    FROM posts p
    JOIN users u ON p.author_id = u.id
    LEFT JOIN post_metadata pm ON pm.post_id = p.id
    LEFT JOIN taxonomy_relationships tr ON tr.type_id = p.id AND tr.type = 'post'
  `;

  const values = [];
  const conditions = [];

  if (postType) {
    values.push(postType);
    conditions.push(`p.post_type = $${values.length}`);
  }

  if (authorId) {
    values.push(authorId);
    conditions.push(`p.author_id = $${values.length}`);
  }

  if (termIds.length) {
    const placeholders = termIds.map((_, i) => `$${values.length + i + 1}`).join(", ");
    conditions.push(`tr.term_id IN (${placeholders})`);
    values.push(...termIds);
  }

  if (conditions.length) query += ` WHERE ${conditions.join(" AND ")}`;
  query += ` GROUP BY p.id, u.email`;

  const metadataKeys = Object.keys(metadataFilters);
  if (metadataKeys.length) {
    const havingConditions = metadataKeys.map(key => {
      values.push(key, metadataFilters[key]);
      const keyParam = `$${values.length - 1}`;
      const valueParam = `$${values.length}`;
      return `COUNT(*) FILTER (WHERE pm.key = ${keyParam} AND pm.value = ${valueParam}) > 0`;
    });
    query += ` HAVING ${havingConditions.join(" AND ")}`;
  }
  
  values.push(limit, offset);

  query += ` ORDER BY p.created_at DESC, p.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;

  const result = await pool.query(query, values);
  return result.rows;
};


const updatePostById = async (id, postType, title, slug) => {
  const result = await pool.query(
    `UPDATE posts SET post_type = $1, title = $2, slug = $3 WHERE id = $4 RETURNING *`,
    [postType, title, slug, id]
  );
  return result.rows[0] || null;
};

const deletePostById = async (id) => {
  const result = await pool.query(`DELETE FROM posts WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] || null;
};

const getMetadataByPostId = async (postId) => {
  const result = await pool.query(`SELECT * FROM post_metadata WHERE post_id = $1`, [postId]);
  return result.rows;
};

const upsertPostMetadata = async (postId, key, value) => {
  const result = await pool.query(
    `INSERT INTO post_metadata (post_id, key, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (post_id, key) DO UPDATE SET value = EXCLUDED.value
     RETURNING post_id, key, value`,
    [postId, key, value]
  );
  return result.rows[0];
};

const deletePostMetadataById = async (id) => {
  const result = await pool.query(`DELETE FROM post_metadata WHERE id = $1 RETURNING *`, [id]);
  return result.rows[0] || null;
};

const addTermToPost = async (postId, termId) => {
  await pool.query(
    `INSERT INTO taxonomy_relationships (type_id, type, term_id, taxonomy_id)
     VALUES ($1, 'post', $2, (SELECT taxonomy_id FROM terms WHERE id = $2))
     ON CONFLICT (type_id, type, term_id) DO NOTHING`,
    [postId, termId]
  );
};

const removeTermsFromPost = async (postId) => {
  await pool.query(`DELETE FROM taxonomy_relationships WHERE type_id = $1 AND type = 'post'`, [postId]);
};
const getPostsByTermIds = async (termIds = []) => {
  if (!termIds.length) return [];

  const placeholders = termIds.map((_, i) => `$${i + 1}`).join(", ");

  const query = `
    SELECT 
      p.*, 
      u.email AS author_email,
      COALESCE(
        json_agg(json_build_object('key', pm.key, 'value', pm.value)) 
        FILTER (WHERE pm.id IS NOT NULL), '[]'
      ) AS metadata,
      json_agg(
        json_build_object('term_id', t.id, 'term_slug', t.slug, 'term_title', t.title)
      ) FILTER (WHERE t.id IS NOT NULL) AS terms
    FROM posts p
    JOIN users u ON p.author_id = u.id
    LEFT JOIN post_metadata pm ON pm.post_id = p.id
    LEFT JOIN taxonomy_relationships tr ON tr.type_id = p.id AND tr.type = 'post'
    LEFT JOIN terms t ON t.id = tr.term_id
    WHERE tr.term_id IN (${placeholders})
    GROUP BY p.id, u.email
    ORDER BY p.created_at DESC
  `;

  const result = await pool.query(query, termIds);
  return result.rows;
};

module.exports = {
  createPost,
  getPostById,
  getPostBySlug,
  getAllPosts,
  updatePostById,
  deletePostById,
  getMetadataByPostId,
  upsertPostMetadata,
  deletePostMetadataById,
  addTermToPost,
  removeTermsFromPost,
  getPostsByTermIds
};
