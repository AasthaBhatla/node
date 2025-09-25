const pool = require('../db');

const getItems = async (filters = {}) => {
  try {
    let query = `SELECT id, taxonomy_id, term_id, type, type_id, created_at 
                 FROM taxonomy_relationships 
                 WHERE 1=1`;
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

    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  } catch (err) {
    console.error('Error in getItems:', err);
    throw new Error('Error fetching taxonomy items');
  }
};

const createRelationship = async (termId, taxonomyId, type, typeId) => {
  try {
    const query = `
      INSERT INTO taxonomy_relationships (term_id, taxonomy_id, type, type_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const values = [termId, taxonomyId, type, typeId];
    const { rows } = await pool.query(query, values);
    return rows[0]; 
  } catch (err) {
    console.error('Error in createRelationship:', err);
    throw new Error('Error creating relationship');
  }
};

const updateRelationship = async (id, updates) => {
  try {
    const fields = [];
    const values = [];
    let count = 1;

    if (updates.term_id) {
      fields.push(`term_id = $${count++}`);
      values.push(updates.term_id);
    }
    if (updates.taxonomy_id) {
      fields.push(`taxonomy_id = $${count++}`);
      values.push(updates.taxonomy_id);
    }
    if (updates.type) {
      fields.push(`type = $${count++}`);
      values.push(updates.type);
    }
    if (updates.type_id) {
      fields.push(`type_id = $${count++}`);
      values.push(updates.type_id);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    const query = `
      UPDATE taxonomy_relationships
      SET ${fields.join(', ')}
      WHERE id = $${count}
      RETURNING *;
    `;
    values.push(id);

    const { rows } = await pool.query(query, values);
    return rows[0] || null;
  } catch (err) {
    console.error('Error in updateRelationship:', err);
    throw new Error('Error updating relationship');
  }
};

const deleteRelationship = async (id) => {
  try {
    const query = `
      DELETE FROM taxonomy_relationships
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;  
  } catch (err) {
    console.error('Error in deleteRelationship:', err);
    throw new Error('Error deleting relationship');
  }
};

module.exports = {
  getItems,
  createRelationship,
  updateRelationship,
  deleteRelationship
};
