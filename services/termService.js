const pool = require('../db');

const createTerms = async (terms) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const createdTerms = [];

    for (const t of terms) {
      const { taxonomyId, slug, title, parent_id, metadata } = t;

      const { rows } = await client.query(
        `INSERT INTO terms (taxonomy_id, slug, title, parent_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *;`,
        [taxonomyId, slug, title, parent_id || null]
      );
      const term = rows[0];

      if (metadata && typeof metadata === 'object') {
        for (const [key, value] of Object.entries(metadata)) {
          await client.query(
            `INSERT INTO term_metadata (term_id, key, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (term_id, key)
             DO UPDATE SET value = EXCLUDED.value;`,
            [term.id, key, value]
          );
        }
      }

      createdTerms.push(term);
    }

    await client.query('COMMIT');
    return createdTerms;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in createTerms:', err);
    throw new Error('Error creating terms');
  } finally {
    client.release();
  }
};

const getTermsByIds = async (ids) => {
  const { rows: terms } = await pool.query(
    'SELECT * FROM terms WHERE id = ANY($1)',
    [ids]
  );

  if (!terms || terms.length === 0) return [];

  const termIds = terms.map(t => t.id);
  const { rows: metadata } = await pool.query(
    'SELECT * FROM term_metadata WHERE term_id = ANY($1)',
    [termIds]
  );

  return terms.map(term => ({
    ...term,
    metadata: metadata
      .filter(m => m.term_id === term.id)
      .reduce((acc, m) => {
        acc[m.key] = m.value;
        return acc;
      }, {})
  }));
};

const getTermsByTaxonomyIds = async (taxonomyIds) => {
  const { rows: terms } = await pool.query(
    'SELECT * FROM terms WHERE taxonomy_id = ANY($1)',
    [taxonomyIds]
  );

  if (!terms || terms.length === 0) throw new Error('No terms found');

  const termIds = terms.map(t => t.id);
  const { rows: metadata } = await pool.query(
    'SELECT * FROM term_metadata WHERE term_id = ANY($1)',
    [termIds]
  );

  return terms.map(term => ({
    ...term,
    metadata: metadata
      .filter(m => m.term_id === term.id)
      .reduce((acc, m) => {
        acc[m.key] = m.value;
        return acc;
      }, {})
  }));
};

const updateTermsByIds = async (terms) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updatedTerms = [];

    for (const t of terms) {
      const { id, slug, title, parent_id, metadata } = t;

      const { rows } = await client.query(
        `UPDATE terms
         SET slug = $1, title = $2, parent_id = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING *;`,
        [slug, title, parent_id || null, id]
      );

      const term = rows[0];
      if (!term) continue;

      if (metadata && typeof metadata === 'object') {
        for (const [key, value] of Object.entries(metadata)) {
          await client.query(
            `INSERT INTO term_metadata (term_id, key, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (term_id, key)
             DO UPDATE SET value = EXCLUDED.value;`,
            [term.id, key, value]
          );
        }
      }

      updatedTerms.push(term);
    }

    await client.query('COMMIT');
    return updatedTerms;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in updateTermsByIds:', err);
    throw new Error('Error updating terms');
  } finally {
    client.release();
  }
};
async function getTermsByTaxonomySlug(slug) {
  try {
    const query = `
      SELECT 
          t.id AS term_id,
          t.slug AS term_slug,
          t.title AS term_title,
          t.parent_id,
          t.created_at,
          t.updated_at,
          COALESCE(
            json_agg(json_build_object('key', tm.key, 'value', tm.value)) 
            FILTER (WHERE tm.id IS NOT NULL), '[]'
          ) AS metadata
      FROM terms t
      JOIN taxonomy tx ON t.taxonomy_id = tx.id
      LEFT JOIN term_metadata tm ON tm.term_id = t.id
      WHERE tx.slug = $1
      GROUP BY t.id
      ORDER BY t.id;
    `;

    const { rows } = await pool.query(query, [slug]);
    return rows;
  } catch (error) {
    console.error('Error fetching terms by taxonomy slug:', error);
    throw error;
  }
}
module.exports = {
  createTerms,
  getTermsByIds,
  getTermsByTaxonomyIds,
  getTermsByTaxonomySlug,
  updateTermsByIds
};
