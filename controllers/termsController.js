const {
  createTerms,
  getTermsByIds,
  getTermsByTaxonomyIds,
  updateTermsByIds,
  getTermsByTaxonomySlug,
  searchTerms
} = require('../services/termService');

exports.create = async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const terms = req.body;
    if (!Array.isArray(terms) || terms.length === 0) {
      return res.status(400).json({ error: 'An array of terms is required' });
    }

    for (const t of terms) {
      if (!t.taxonomyId || !t.slug || !t.title) {
        return res.status(400).json({
          error: 'taxonomyId, slug, and title are required for each term'
        });
      }
      if (t.parent_id && isNaN(Number(t.parent_id))) {
        return res.status(400).json({ error: 'parent_id must be a number' });
      }
    }

    const created = await createTerms(terms);
    res.status(201).json({ message: 'Terms created successfully', data: created });
  } catch (err) {
    console.error('Create Terms Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const terms = await getTermsByIds([parseInt(id)]);
    if (!terms || terms.length === 0) {
      return res.status(404).json({ error: 'No term found' });
    }

    res.status(200).json(terms[0]);
  } catch (err) {
    console.error('Get Term by ID Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getByTaxonomyIds = async (req, res) => {
  try {
    const { taxonomyIds } = req.body;
    if (!Array.isArray(taxonomyIds) || taxonomyIds.length === 0) {
      return res.status(400).json({ error: 'taxonomyIds must be a non-empty array' });
    }

    const terms = await getTermsByTaxonomyIds(taxonomyIds);
    res.status(200).json(terms);
  } catch (err) {
    console.error('Get Terms by Taxonomy IDs Error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const terms = req.body;
    if (!Array.isArray(terms) || terms.length === 0) {
      return res.status(400).json({ error: 'An array of terms is required' });
    }

    for (const t of terms) {
      if (!t.id || !t.slug || !t.title) {
        return res.status(400).json({
          error: 'id, slug, and title are required for each term'
        });
      }
      if (t.parent_id && isNaN(Number(t.parent_id))) {
        return res.status(400).json({ error: 'parent_id must be a number' });
      }
    }

    const updated = await updateTermsByIds(terms);
    if (!updated || updated.length === 0) {
      return res.status(404).json({ error: 'No terms updated' });
    }

    res.status(200).json({ message: 'Terms updated successfully', data: updated });
  } catch (err) {
    console.error('Update Terms Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
exports.getTermsBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slug) {
      return res.status(400).json({ error: 'Slug is required' });
    }

    const terms = await getTermsByTaxonomySlug(slug);
    res.status(200).json({ success: true, data: terms });
  } catch (err) {
    console.error('Get Terms by Taxonomy Slug Error:', err);
    res.status(500).json({ error: err.message });
  }
};
exports.search = async (req, res) => {
  try {
    const { keyword } = req.query;

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ error: 'Keyword is required for search' });
    }

    const results = await searchTerms(keyword);
    res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('Search Terms Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
