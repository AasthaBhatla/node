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

const deleteTermById = async ({ id, confirmSlug, childPolicy = 'block' }) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      rows: [existingTerm]
    } = await client.query(
      `SELECT id, taxonomy_id, slug, title
       FROM terms
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (!existingTerm) {
      await client.query('ROLLBACK');
      return null;
    }

    if (!confirmSlug || confirmSlug.trim() !== existingTerm.slug) {
      const error = new Error('Confirmation slug does not match the selected term');
      error.status = 400;
      error.code = 'TERM_CONFIRM_SLUG_MISMATCH';
      throw error;
    }

    const {
      rows: [{ count: childrenCountRaw }]
    } = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM terms
       WHERE parent_id = $1`,
      [id]
    );
    const childrenCount = Number(childrenCountRaw ?? 0);

    if (childrenCount > 0 && childPolicy !== 'orphan') {
      const error = new Error('Term has child terms and cannot be deleted until those child terms are reassigned or removed');
      error.status = 409;
      error.code = 'TERM_HAS_CHILDREN';
      error.children_count = childrenCount;
      throw error;
    }

    const {
      rows: [{ count: relationshipsDeletedRaw }]
    } = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM taxonomy_relationships
       WHERE term_id = $1`,
      [id]
    );

    const {
      rows: [{ count: metadataDeletedRaw }]
    } = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM term_metadata
       WHERE term_id = $1`,
      [id]
    );

    const {
      rows: [deleted]
    } = await client.query(
      `DELETE FROM terms
       WHERE id = $1
       RETURNING id, taxonomy_id, slug, title`,
      [id]
    );

    await client.query('COMMIT');

    return {
      message: 'Term deleted successfully',
      deleted,
      effects: {
        relationships_deleted: Number(relationshipsDeletedRaw ?? 0),
        metadata_deleted: Number(metadataDeletedRaw ?? 0),
        children_orphaned: childPolicy === 'orphan' ? childrenCount : 0
      }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in deleteTermById:', err);
    throw err;
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
const searchTerms = async (keyword) => {
  try {
    const query = `
      SELECT 
        t.id,
        t.slug,
        t.title,
        t.parent_id,
        t.taxonomy_id,
        COALESCE(
          json_agg(json_build_object('key', tm.key, 'value', tm.value))
          FILTER (WHERE tm.id IS NOT NULL), '[]'
        ) AS metadata
      FROM terms t
      LEFT JOIN term_metadata tm ON t.id = tm.term_id
      WHERE t.title ILIKE $1 OR t.slug ILIKE $1
      GROUP BY t.id
      ORDER BY t.title;
    `;
    const values = [`%${keyword}%`]; 
    const { rows } = await pool.query(query, values);
    return rows;
  } catch (error) {
    console.error('Error in searchTerms:', error);
    throw new Error('Error searching terms');
  }
};

module.exports = {
  createTerms,
  deleteTermById,
  getTermsByIds,
  getTermsByTaxonomyIds,
  getTermsByTaxonomySlug,
  updateTermsByIds,
  searchTerms
};
