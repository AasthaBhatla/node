const pool = require('../db');

const createTaxonomy = async (slug, title) => {
  try {
    const result = await pool.query(
      `INSERT INTO taxonomy (slug, title) VALUES ($1, $2) RETURNING *`,
      [slug, title]
    );
    return result.rows[0];
  } catch (err) {
    console.error('DB Error creating taxonomy:', err); 
    throw err; 
  }
};

const getTaxonomyById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT * FROM taxonomy WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error fetching taxonomy by ID');
  }
};

const getAllTaxonomies = async () => {
  try {
    const result = await pool.query(`SELECT * FROM taxonomy`);
    return result.rows;
  } catch (err) {
    throw new Error('Error fetching all taxonomies');
  }
};

const updateTaxonomyById = async (id, slug, title) => {
  try {
    const result = await pool.query(
      `UPDATE taxonomy SET slug = $1, title = $2 WHERE id = $3 RETURNING *`,
      [slug, title, id]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error updating taxonomy');
  }
};

const getTaxonomyBySlug = async (slug) => {
  try {
    const result = await pool.query(
      `SELECT * FROM taxonomy WHERE slug = $1`,
      [slug]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error fetching taxonomy by slug');
  }
};

const getTaxonomyByTermId = async (termId) => {
  try {
    const result = await pool.query(
      `SELECT t.* FROM taxonomy t JOIN terms tr ON tr.taxonomy_id = t.id WHERE tr.id = $1`,
      [termId]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error fetching taxonomy by term ID');
  }
};

module.exports = {
  createTaxonomy,
  getTaxonomyById,
  getAllTaxonomies,
  updateTaxonomyById,
  getTaxonomyBySlug,
  getTaxonomyByTermId
};
