const pool = require('../db');

const createTerm = async (taxonomyId, slug, title) => {
  try {
    const result = await pool.query(
      `INSERT INTO terms (taxonomy_id, slug, title) VALUES ($1, $2, $3) RETURNING *`,
      [taxonomyId, slug, title]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error creating term');
  }
};

const getTermById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT * FROM terms WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error fetching term by ID');
  }
};

const getTermBySlug = async (slug) => {
  try {
    const result = await pool.query(
      `SELECT * FROM terms WHERE slug = $1`,
      [slug]
    );
    return result.rows[0];
  } catch (err) {
    throw new Error('Error fetching term by slug');
  }
};

const getTermsByTaxonomyId = async (taxonomyId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM terms WHERE taxonomy_id = $1`,
      [taxonomyId]
    );
    return result.rows;
  } catch (err) {
    throw new Error('Error fetching terms by taxonomy ID');
  }
};

const getTermsByTaxonomySlug = async (slug) => {
  try {
    const result = await pool.query(
      `SELECT tr.*
       FROM terms tr
       JOIN taxonomy t ON tr.taxonomy_id = t.id
       WHERE t.slug = $1`,
      [slug]
    );
    return result.rows;
  } catch (err) {
    throw new Error('Error fetching terms by taxonomy slug');
  }
};

module.exports = {
  createTerm,
  getTermById,
  getTermBySlug,
  getTermsByTaxonomyId,
  getTermsByTaxonomySlug
};
