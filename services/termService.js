const pool = require('../db');

const createTerm = async (taxonomyId, slug, title, parentId = null) => {
  try {
    const result = await pool.query(
      `INSERT INTO terms (taxonomy_id, slug, title, parent_id) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [taxonomyId, slug, title, parentId]
    );
    return result.rows[0];
  } catch (err) {
    console.error('Error in createTerm:', err);
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

const updateTermByTaxonomyId = async (taxonomyId, termId, slug, title, parentId = null) => {
  try {
    if (parentId && parseInt(parentId) === parseInt(termId)) {
      throw new Error('A term cannot be its own parent');
    }

    if (parentId) {
      const parentCheck = await pool.query(
        `SELECT id FROM terms WHERE id = $1 AND taxonomy_id = $2`,
        [parentId, taxonomyId]
      );
      if (parentCheck.rows.length === 0) {
        throw new Error('Parent term not found in same taxonomy');
      }
    }

    const query = `
      UPDATE terms
      SET slug = $3, title = $4, parent_id = $5, updated_at = NOW()
      WHERE taxonomy_id = $1 AND id = $2
      RETURNING *;
    `;
    const values = [taxonomyId, termId, slug, title, parentId || null];
    const { rows } = await pool.query(query, values);
    return rows[0] || null;
  } catch (err) {
    console.error('Error in updateTermByTaxonomyId:', err);
    throw err;
  }
};

const updateTermById = async (id, slug, title, parentId = null) => {
  try {
    if (parentId && parseInt(parentId) === parseInt(id)) {
      throw new Error('A term cannot be its own parent');
    }

    if (parentId) {
      const parentCheck = await pool.query(
        `SELECT id FROM terms WHERE id = $1`,
        [parentId]
      );
      if (parentCheck.rows.length === 0) {
        throw new Error('Parent term not found');
      }
    }

    const query = `
      UPDATE terms
      SET slug = $1, title = $2, parent_id = $3, updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `;
    const values = [slug, title, parentId || null, id];

    const { rows } = await pool.query(query, values);
    return rows[0] || null;
  } catch (err) {
    console.error('Error in updateTermById:', err);
    throw err;
  }
};

const deleteTermById = async (id) => {
  try {
    const result = await pool.query(
      `DELETE FROM terms WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('Error in deleteTermById:', err);
    throw new Error('Error deleting term by ID');
  }
};

module.exports = {
  createTerm,
  getTermById,
  getTermBySlug,
  getTermsByTaxonomyId,
  getTermsByTaxonomySlug,
  updateTermByTaxonomyId,
  updateTermById,
  deleteTermById
};
