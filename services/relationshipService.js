const pool = require('../db');

const getItems = async (filters = {}) => {
  try {
    let query = `
      SELECT id, taxonomy_id, term_id, type, type_id, created_at 
      FROM taxonomy_relationships 
      WHERE 1=1
    `;
    const params = [];
    let count = 1;

    if (filters.taxonomy_id) {
      query += ` AND taxonomy_id = $${count++}`;
      params.push(filters.taxonomy_id);
    }
    if (filters.type_id) {
      query += ` AND type_id = $${count++}`;
      params.push(filters.type_id);
    }
    if (filters.type) {
      query += ` AND type = $${count++}`;
      params.push(filters.type);
    }
    if (filters.term_id) {
      query += ` AND term_id = $${count++}`;
      params.push(filters.term_id);
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  } catch (err) {
    console.error('DB Error fetching items:', err);
    throw new Error('Error fetching taxonomy items');
  }
};

const createRelationship = async (data) => {
  try {
    const items = Array.isArray(data) ? data : [data];
    const replaced = [];

    for (const { term_id, taxonomy_id, type, type_id } of items) {
      await pool.query(
        `DELETE FROM taxonomy_relationships 
         WHERE term_id = $1 AND taxonomy_id = $2 AND type = $3 AND type_id = $4`,
        [term_id, taxonomy_id, type, type_id]
      );

      const result = await pool.query(
        `INSERT INTO taxonomy_relationships (term_id, taxonomy_id, type, type_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [term_id, taxonomy_id, type, type_id]
      );

      replaced.push(result.rows[0]);
    }

    return replaced;
  } catch (err) {
    console.error('DB Error creating relationship:', err);
    throw new Error('Error creating/replacing relationship(s)');
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
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [term_id, taxonomy_id, type, type_id]
      );
      created.push(result.rows[0]);
    }

    return created;
  } catch (err) {
    console.error('DB Error updating relationship:', err);
    throw new Error('Error replacing relationships');
  }
};

const deleteRelationship = async (ids) => {
  try {
    const items = Array.isArray(ids) ? ids : [ids];
    const deleted = [];

    for (const id of items) {
      const result = await pool.query(
        `DELETE FROM taxonomy_relationships WHERE id = $1 RETURNING *`,
        [id]
      );
      if (result.rows[0]) deleted.push(result.rows[0]);
    }

    return deleted;
  } catch (err) {
    console.error('DB Error deleting relationship:', err);
    throw new Error('Error deleting relationship(s)');
  }
};

module.exports = {
  getItems,
  createRelationship,
  updateRelationship,
  deleteRelationship,
};
