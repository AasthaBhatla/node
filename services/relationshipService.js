const pool = require('../db');

// --- Get items ---
const getItems = async (filters = {}) => {
  try {
    let query = `SELECT id, taxonomy_id, term_id, type, type_id, created_at 
                 FROM taxonomy_relationships WHERE 1=1`;
    const params = [];
    let count = 1;

    if (filters.taxonomy_id) { query += ` AND taxonomy_id = $${count++}`; params.push(filters.taxonomy_id); }
    if (filters.type_id) { query += ` AND type_id = $${count++}`; params.push(filters.type_id); }
    if (filters.type) { query += ` AND type = $${count++}`; params.push(filters.type); }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  } catch (err) {
    console.error('Error in getItems:', err);
    throw new Error('Error fetching taxonomy items');
  }
};

// --- Create (single or multiple) ---
const createRelationship = async (data) => {
  const items = Array.isArray(data) ? data : [data];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];

    for (const { term_id, taxonomy_id, type, type_id } of items) {
      const res = await client.query(
        `INSERT INTO taxonomy_relationships (term_id, taxonomy_id, type, type_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [term_id, taxonomy_id, type, type_id]
      );
      created.push(res.rows[0]);
    }

    await client.query('COMMIT');
    return Array.isArray(data) ? created : created[0];
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in createRelationship:', err);
    throw new Error('Error creating relationship(s)');
  } finally {
    client.release();
  }
};

// --- Update (single or multiple) ---
const updateRelationship = async (data) => {
  const items = Array.isArray(data) ? data : [data];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = [];

    for (const { id, term_id, taxonomy_id, type, type_id } of items) {
      const fields = [];
      const values = [];
      let count = 1;

      if (term_id) { fields.push(`term_id = $${count++}`); values.push(term_id); }
      if (taxonomy_id) { fields.push(`taxonomy_id = $${count++}`); values.push(taxonomy_id); }
      if (type) { fields.push(`type = $${count++}`); values.push(type); }
      if (type_id) { fields.push(`type_id = $${count++}`); values.push(type_id); }

      if (fields.length === 0) continue;

      values.push(id);
      const res = await client.query(
        `UPDATE taxonomy_relationships SET ${fields.join(', ')} WHERE id = $${count} RETURNING *`,
        values
      );
      if (res.rows[0]) updated.push(res.rows[0]);
    }

    await client.query('COMMIT');
    return Array.isArray(data) ? updated : updated[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in updateRelationship:', err);
    throw new Error('Error updating relationship(s)');
  } finally {
    client.release();
  }
};

// --- Delete (single or multiple) ---
const deleteRelationship = async (ids) => {
  const items = Array.isArray(ids) ? ids : [ids];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = [];

    for (const id of items) {
      const res = await client.query(
        `DELETE FROM taxonomy_relationships WHERE id = $1 RETURNING *`,
        [id]
      );
      if (res.rows[0]) deleted.push(res.rows[0]);
    }

    await client.query('COMMIT');
    return Array.isArray(ids) ? deleted : deleted[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in deleteRelationship:', err);
    throw new Error('Error deleting relationship(s)');
  } finally {
    client.release();
  }
};

module.exports = {
  getItems,
  createRelationship,
  updateRelationship,
  deleteRelationship
};
