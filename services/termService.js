const pool = require('../db');

const createTerms = async (terms) => {
  try {
    const values = [];
    const placeholders = terms.map((t, i) => {
      const idx = i * 4;
      values.push(t.taxonomyId, t.slug, t.title, t.parentId || null);
      return `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`;
    }).join(', ');

    const query = `
      INSERT INTO terms (taxonomy_id, slug, title, parent_id)
      VALUES ${placeholders}
      RETURNING *;
    `;
    const { rows } = await pool.query(query, values);
    return rows;
  } catch (err) {
    console.error('Error in createTerms:', err);
    throw new Error('Error creating terms');
  }
};

const getTermsByIds = async (ids) => {
  try {
    const result = await pool.query(
      `SELECT * FROM terms WHERE id = ANY($1::int[])`,
      [ids]
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getTermsByIds:', err);
    throw new Error('Error fetching terms by IDs');
  }
};

const getTermsBySlugs = async (slugs) => {
  try {
    const result = await pool.query(
      `SELECT * FROM terms WHERE slug = ANY($1::text[])`,
      [slugs]
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getTermsBySlugs:', err);
    throw new Error('Error fetching terms by slugs');
  }
};

const getTermsByTaxonomyIds = async (taxonomyIds) => {
  try {
    const result = await pool.query(
      `SELECT * FROM terms WHERE taxonomy_id = ANY($1::int[])`,
      [taxonomyIds]
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getTermsByTaxonomyIds:', err);
    throw new Error('Error fetching terms by taxonomy IDs');
  }
};

const getTermsByTaxonomySlugs = async (slugs) => {
  try {
    const result = await pool.query(
      `SELECT tr.*
       FROM terms tr
       JOIN taxonomy t ON tr.taxonomy_id = t.id
       WHERE t.slug = ANY($1::text[])`,
      [slugs]
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getTermsByTaxonomySlugs:', err);
    throw new Error('Error fetching terms by taxonomy slugs');
  }
};

const updateTermsByTaxonomyId = async (taxonomyId, terms) => {
  try {
    const updatedTerms = [];
    for (const t of terms) {
      if (t.parentId && parseInt(t.parentId) === parseInt(t.termId)) {
        throw new Error('A term cannot be its own parent');
      }

      if (t.parentId) {
        const parentCheck = await pool.query(
          `SELECT id FROM terms WHERE id = $1 AND taxonomy_id = $2`,
          [t.parentId, taxonomyId]
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
      const values = [taxonomyId, t.termId, t.slug, t.title, t.parentId || null];
      const { rows } = await pool.query(query, values);
      if (rows[0]) updatedTerms.push(rows[0]);
    }
    return updatedTerms;
  } catch (err) {
    console.error('Error in updateTermsByTaxonomyId:', err);
    throw err;
  }
};

const updateTermsByIds = async (terms) => {
  try {
    const updatedTerms = [];
    for (const t of terms) {
      if (t.parentId && parseInt(t.parentId) === parseInt(t.id)) {
        throw new Error('A term cannot be its own parent');
      }

      if (t.parentId) {
        const parentCheck = await pool.query(
          `SELECT id FROM terms WHERE id = $1`,
          [t.parentId]
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
      const values = [t.slug, t.title, t.parentId || null, t.id];
      const { rows } = await pool.query(query, values);
      if (rows[0]) updatedTerms.push(rows[0]);
    }
    return updatedTerms;
  } catch (err) {
    console.error('Error in updateTermsByIds:', err);
    throw err;
  }
};

const deleteTermsByIds = async (ids) => {
  try {
    const result = await pool.query(
      `DELETE FROM terms WHERE id = ANY($1::int[]) RETURNING *`,
      [ids]
    );
    return result.rows;
  } catch (err) {
    console.error('Error in deleteTermsByIds:', err);
    throw new Error('Error deleting terms by IDs');
  }
};

module.exports = {
  createTerms,
  getTermsByIds,
  getTermsBySlugs,
  getTermsByTaxonomyIds,
  getTermsByTaxonomySlugs,
  updateTermsByTaxonomyId,
  updateTermsByIds,
  deleteTermsByIds
};
