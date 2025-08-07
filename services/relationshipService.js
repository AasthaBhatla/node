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

module.exports = {
  getItemsByTerm,
  getItemsByTaxonomy,
};
