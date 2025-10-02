const {
  createTerms,
  getTermsByIds,
  getTermsByTaxonomyIds,
  updateTermsByIds
} = require('../services/termService');

exports.create = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const terms = req.body; 
    if (!Array.isArray(terms) || terms.length === 0) {
      return res.status(400).json({ error: 'An array of terms is required' });
    }

    for (const t of terms) {
      if (!t.taxonomyId || !t.slug || !t.title) {
        return res.status(400).json({ error: 'taxonomyId, slug, and title are required for each term' });
      }
    }

    const created = await createTerms(terms);
    res.status(201).json(created);
  } catch (err) {
    console.error('Create Terms Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const terms = await getTermsByIds([parseInt(id)]);
    if (!terms || terms.length === 0) {
      return res.status(404).json({ error: 'No term found' });
    }

    res.json(terms[0]);
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
    if (!terms || terms.length === 0) {
      return res.status(404).json({ error: 'No terms found for the given taxonomy IDs' });
    }

    res.json(terms);
  } catch (err) {
    console.error('Get Terms by Taxonomy IDs Error:', err.message);
    if (err.message.includes('No terms found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateByIds = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const terms = req.body; 
    if (!Array.isArray(terms) || terms.length === 0) {
      return res.status(400).json({ error: 'An array of terms is required' });
    }

    for (const t of terms) {
      if (!t.id || !t.slug || !t.title) {
        return res.status(400).json({ error: 'id, slug, and title are required for each term' });
      }
    }

    const updated = await updateTermsByIds(terms);

    if (!updated || updated.length === 0) {
      return res.status(404).json({ error: 'No terms updated' });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update Terms by IDs Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
