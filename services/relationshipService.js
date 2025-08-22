const pool = require('../db');

const getItemsByTerm = async (termId) => {
  try {
    const result = await pool.query(
      `SELECT type, type_id FROM taxonomy_relationships WHERE term_id = $1`,
      [termId]
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getItemsByTerm:', err);
    throw new Error('Error fetching items by term');
  }
};

const getItemsByTaxonomy = async (taxonomyId) => {
  try {
    const result = await pool.query(
      `SELECT type, type_id FROM taxonomy_relationships WHERE taxonomy_id = $1`,
      [taxonomyId]
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getItemsByTaxonomy:', err);
    throw new Error('Error fetching items by taxonomy');
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

const deleteRelationship = async (id) => {
  try {
    const query = `
      DELETE FROM taxonomy_relationships
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;  // return deleted row or null if not found
  } catch (err) {
    console.error('Error in deleteRelationship:', err);
    throw new Error('Error deleting relationship');
  }
};

module.exports = {
  getItemsByTerm,
  getItemsByTaxonomy,
  createRelationship,
  deleteRelationship
};
