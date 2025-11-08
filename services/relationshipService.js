const pool = require("../db");

const getItems = async (filters = {}) => {
  try {
    let query = `
      SELECT 
        tr.id,
        tr.taxonomy_id,
        tr.term_id,
        tr.type,
        tr.type_id,
        tr.created_at,
        tx.slug AS taxonomy_slug,
        tx.title AS taxonomy_title,
        te.slug AS term_slug,
        te.title AS term_title
      FROM taxonomy_relationships tr
      LEFT JOIN taxonomy tx ON tr.taxonomy_id = tx.id
      LEFT JOIN terms te ON tr.term_id = te.id
      WHERE 1=1
    `;

    const params = [];
    let count = 1;

    if (filters.taxonomy_id) {
      query += ` AND tr.taxonomy_id = $${count++}`;
      params.push(filters.taxonomy_id);
    }
    if (filters.type_id) {
      query += ` AND tr.type_id = $${count++}`;
      params.push(filters.type_id);
    }
    if (filters.type) {
      query += ` AND tr.type = $${count++}`;
      params.push(filters.type);
    }
    if (filters.term_id) {
      query += ` AND tr.term_id = $${count++}`;
      params.push(filters.term_id);
    }

    query += ` ORDER BY tr.created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows.map(({ id, created_at, ...rest }) => rest);
  } catch (err) {
    console.error("DB Error fetching items:", err);
    throw new Error("Error fetching taxonomy items");
  }
};

const createRelationship = async (data) => {
  // try {
  //   const items = Array.isArray(data) ? data : [data];
  //   const replaced = [];

  //   const taxonomyIds = [...new Set(items.map(i => i.taxonomy_id))];
  //   for (const taxonomy_id of taxonomyIds) {
  //     await pool.query(`DELETE FROM taxonomy_relationships WHERE taxonomy_id = $1`, [taxonomy_id]);
  //   }

  //   for (const { term_id, taxonomy_id, type, type_id } of items) {
  //     const result = await pool.query(
  //       `INSERT INTO taxonomy_relationships (term_id, taxonomy_id, type, type_id)
  //        VALUES ($1, $2, $3, $4)
  //        RETURNING id, term_id, taxonomy_id, type, type_id, created_at`,
  //       [term_id, taxonomy_id, type, type_id]
  //     );

  //     const { id, created_at, ...clean } = result.rows[0];
  //     replaced.push(clean);
  //   }

  //   return replaced;
  // } catch (err) {
  //   console.error('DB Error creating relationship:', err);
  //   throw new Error('Error creating/replacing relationship(s)');
  // }

  try {
    const items = Array.isArray(data) ? data : [data];
    const { taxonomy_id, type, type_id } = items[0];

    await pool.query(
      `DELETE FROM taxonomy_relationships 
       WHERE taxonomy_id = $1 AND type = $2 AND type_id = $3`,
      [taxonomy_id, type, type_id]
    );

    const created = [];
    for (const { term_id } of items) {
      const result = await pool.query(
        `INSERT INTO taxonomy_relationships (term_id, taxonomy_id, type, type_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, term_id, taxonomy_id, type, type_id, created_at`,
        [term_id, taxonomy_id, type, type_id]
      );

      const { id, created_at, ...clean } = result.rows[0];
      created.push(clean);
    }

    return created;
  } catch (err) {
    console.error("DB Error updating relationship:", err);
    throw new Error("Error replacing relationships");
  }
};

const updateRelationship = async (data) => {
  try {
    const items = Array.isArray(data) ? data : [data];
    const { taxonomy_id, type, type_id } = items[0];

    await pool.query(
      `DELETE FROM taxonomy_relationships 
       WHERE taxonomy_id = $1 AND type = $2 AND type_id = $3`,
      [taxonomy_id, type, type_id]
    );

    const created = [];
    for (const { term_id } of items) {
      const result = await pool.query(
        `INSERT INTO taxonomy_relationships (term_id, taxonomy_id, type, type_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, term_id, taxonomy_id, type, type_id, created_at`,
        [term_id, taxonomy_id, type, type_id]
      );

      const { id, created_at, ...clean } = result.rows[0];
      created.push(clean);
    }

    return created;
  } catch (err) {
    console.error("DB Error updating relationship:", err);
    throw new Error("Error replacing relationships");
  }
};

const deleteRelationship = async (ids) => {
  try {
    const items = Array.isArray(ids) ? ids : [ids];
    const deleted = [];

    for (const id of items) {
      const result = await pool.query(
        `DELETE FROM taxonomy_relationships WHERE id = $1 RETURNING id, term_id, taxonomy_id, type, type_id, created_at`,
        [id]
      );
      if (result.rows[0]) {
        const { id, created_at, ...clean } = result.rows[0];
        deleted.push(clean);
      }
    }

    return deleted;
  } catch (err) {
    console.error("DB Error deleting relationship:", err);
    throw new Error("Error deleting relationship(s)");
  }
};

const getTypeIdsService = async (filters = {}) => {
  try {
    let query = `SELECT DISTINCT type_id FROM taxonomy_relationships WHERE 1=1`;
    const params = [];
    let count = 1;

    if (filters.term_id && filters.term_id.length > 0) {
      const placeholders = filters.term_id.map(() => `$${count++}`).join(", ");
      query += ` AND term_id IN (${placeholders})`;
      params.push(...filters.term_id);
    }

    if (filters.type) {
      query += ` AND type = $${count++}`;
      params.push(filters.type);
    }

    query += ` ORDER BY type_id`;

    const { rows } = await pool.query(query, params);

    return rows.map((row) => row.type_id) || [];
  } catch (err) {
    console.error("DB Error fetching type IDs:", err);
    throw new Error("Error fetching type IDs");
  }
};

module.exports = {
  getItems,
  createRelationship,
  updateRelationship,
  deleteRelationship,
  getTypeIdsService,
};
