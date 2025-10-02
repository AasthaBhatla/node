const pool = require('../db');

const createTerms = async (terms) => {
  const values = [];
  const placeholders = terms.map((t, index) => {
    const i = index * 3; 
    values.push(t.taxonomyId, t.slug, t.title);
    return `($${i + 1}, $${i + 2}, $${i + 3})`;
  }).join(',');

  const query = `
    INSERT INTO terms (taxonomy_id, slug, title)
    VALUES ${placeholders}
    RETURNING *;
  `;

  const { rows } = await pool.query(query, values);
  return rows;
};

const getTermsByIds = async (ids) => {
  const query = 'SELECT * FROM terms WHERE id = ANY($1)';
  const { rows } = await pool.query(query, [ids]);
  return rows;
};

const getTermsByTaxonomyIds = async (taxonomyIds) => {
  const query = 'SELECT * FROM terms WHERE taxonomy_id = ANY($1)';
  const { rows } = await pool.query(query, [taxonomyIds]);

  if (!rows || rows.length === 0) {
    throw new Error('No terms found for the given taxonomy IDs');
  }

  return rows;
};

const updateTermsByIds = async (terms) => {
  const updatedRows = [];

  for (const t of terms) {
    const query = `
      UPDATE terms
      SET slug = $1, title = $2
      WHERE id = $3
      RETURNING *;
    `;
    const values = [t.slug, t.title, t.id];
    const { rows } = await pool.query(query, values);
    if (rows.length > 0) {
      updatedRows.push(rows[0]);
    }
  }

  return updatedRows;
};

module.exports = {
  createTerms,
  getTermsByIds,
  getTermsByTaxonomyIds,
  updateTermsByIds,
};
