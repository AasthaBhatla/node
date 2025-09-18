const pool = require("../db");

const createPost = async (postType, title, slug, authorId) => {
  try {
    const result = await pool.query(
  `INSERT INTO posts (post_type, title, slug, author_id)
   VALUES ($1, $2, $3, $4)
   RETURNING *`,
  [postType || 'post', title, slug, authorId]   
);
    return result.rows[0];
  } catch (err) {
    console.error("Error in createPost:", err);
    throw new Error("Error creating post");
  }
};

const createPostMetadata = async (postId, key, value) => {
  try {
    const result = await pool.query(
      `INSERT INTO post_metadata (post_id, key, value)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [postId, key, value]
    );
    return result.rows[0];
  } catch (err) {
    console.error("Error in createPostMetadata:", err);
    throw new Error("Error creating post metadata");
  }
};

const getPostById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.email AS author_email
       FROM posts p
       JOIN users u ON p.author_id = u.id
       WHERE p.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in getPostById:", err);
    throw new Error("Error fetching post by ID");
  }
};

const getPostBySlug = async (slug) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.email AS author_email
       FROM posts p
       JOIN users u ON p.author_id = u.id
       WHERE p.slug = $1`,
      [slug]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in getPostBySlug:", err);
    throw new Error("Error fetching post by slug");
  }
};

const getAllPosts = async (
  offset = 0,
  limit = 10,
  postType = "post",
  termIds = [],
  metadataFilters = {}
) => {
  try {
    let query = `
      SELECT 
        p.*, 
        u.email AS author_email,
        COALESCE(
          json_agg(
            json_build_object('key', pm.key, 'value', pm.value)
          ) FILTER (WHERE pm.id IS NOT NULL), '[]'
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

    if (termIds.length > 0) {
      const termPlaceholders = termIds.map((_, i) => `$${values.length + i + 1}`).join(", ");
      conditions.push(`tr.term_id IN (${termPlaceholders})`);
      values.push(...termIds);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` GROUP BY p.id, u.email`;

    const metadataKeys = Object.keys(metadataFilters);
    if (metadataKeys.length > 0) {
      let havingConditions = [];

      metadataKeys.forEach((key, i) => {
        const keyParam = `$${values.length + 1}`;
        const valueParam = `$${values.length + 2}`;
        values.push(key, metadataFilters[key]);

        havingConditions.push(`
          COUNT(*) FILTER (WHERE pm.key = ${keyParam} AND pm.value = ${valueParam}) > 0
        `);
      });

      query += ` HAVING ${havingConditions.join(" AND ")}`;
    }

    values.push(limit, offset);
    query += ` ORDER BY p.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;

    const result = await pool.query(query, values);
    return result.rows;
  } catch (err) {
    console.error("Error in getAllPosts:", err);
    throw new Error("Error fetching posts");
  }
};


const getMetadataByPostId = async (postId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM post_metadata WHERE post_id = $1`,
      [postId]
    );
    return result.rows;
  } catch (err) {
    console.error("Error in getMetadataByPostId:", err);
    throw new Error("Error fetching post metadata");
  }
};

const updatePostById = async (id, postType, title, slug) => {
  try {
    const result = await pool.query(
      `UPDATE posts
       SET post_type = $1, title = $2, slug = $3
       WHERE id = $4
       RETURNING *`,
      [postType, title, slug, id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in updatePostById:", err);
    throw new Error("Error updating post");
  }
};

const updatePostMetadata = async (id, key, value) => {
  try {
    const result = await pool.query(
      `UPDATE post_metadata
       SET key = $1, value = $2
       WHERE id = $3
       RETURNING *`,
      [key, value, id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in updatePostMetadata:", err);
    throw new Error("Error updating post metadata");
  }
};

const deletePostById = async (id) => {
  try {
    const result = await pool.query(
      `DELETE FROM posts WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in deletePostById:", err);
    throw new Error("Error deleting post");
  }
};

const deletePostMetadataById = async (id) => {
  try {
    const result = await pool.query(
      `DELETE FROM post_metadata WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in deletePostMetadataById:", err);
    throw new Error("Error deleting post metadata");
  }
};

async function upsertPostMetadata(postId, key, value) {
  try {
    const query = `
      INSERT INTO post_metadata (post_id, key, value)
      VALUES ($1, $2, $3)
      ON CONFLICT (post_id, key)
      DO UPDATE SET value = EXCLUDED.value
      RETURNING post_id, key, value;
      `;
    const { rows } = await pool.query(query, [postId, key, value]);
    return rows[0];
  } catch (err) {
    console.error("Error in deletePostMetadataById:", err);
    throw new Error("Error upserting post metadata");
  }
}
const addTermToPost = async (postId, termId) => {
  try {
    await pool.query(
      `INSERT INTO taxonomy_relationships (type_id, type, term_id, taxonomy_id)
       VALUES ($1, 'post', $2, (SELECT taxonomy_id FROM terms WHERE id = $2))
       ON CONFLICT (type_id, type, term_id) DO NOTHING`,
      [postId, termId]
    );
  } catch (err) {
    console.error("Error in addTermToPost:", err);
    throw new Error("Error adding term to post");
  }
};
const removeTermsFromPost = async (postId) => {
  try {
    await pool.query(
      `DELETE FROM taxonomy_relationships 
       WHERE type_id = $1 AND type = 'post'`,
      [postId]
    );
  } catch (err) {
    console.error("Error in removeTermsFromPost:", err);
    throw new Error("Error removing terms from post");
  }
};


module.exports = {
  createPost,
  createPostMetadata,
  getPostById,
  getPostBySlug,
  getAllPosts,
  getMetadataByPostId,
  updatePostById,
  updatePostMetadata,
  upsertPostMetadata,
  deletePostById,
  deletePostMetadataById,
  addTermToPost,
  removeTermsFromPost
};
