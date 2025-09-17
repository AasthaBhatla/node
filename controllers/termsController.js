const {
  createTerm,
  getTermById,
  getTermsByTaxonomyId,
  updateTermById
} = require('../services/termService');

exports.create = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { taxonomyId, slug, title, parentId } = req.body;
    if (!taxonomyId || !slug || !title) {
      return res.status(400).json({ error: 'taxonomyId, slug, and title are required' });
    }

    const term = await createTerm(taxonomyId, slug, title, parentId || null);
    res.status(201).json(term);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getTermById = async (req, res) => {
  try {
    const { id } = req.params;
    const term = await getTermById(id);
    if (!term) {
      return res.status(404).json({ error: 'Term not found' });
    }
    res.json(term);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getTermsByTaxonomyId = async (req, res) => {
  try {
    const { id } = req.params;
    const terms = await getTermsByTaxonomyId(id);
    res.json(terms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateById = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { id } = req.params;
    const { slug, title, parentId } = req.body;

    if (!slug || !title) {
      return res.status(400).json({ error: 'slug and title are required' });
    }

    const updatedTerm = await updateTermById(id, slug, title, parentId || null);

    if (!updatedTerm) {
      return res.status(404).json({ error: 'Term not found' });
    }

    res.json(updatedTerm);
  } catch (err) {
    console.error('Update Term by ID Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

