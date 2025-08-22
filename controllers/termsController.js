const {
  createTerm,
  getTermById,
  getTermsByTaxonomyId,
  updateTermByTaxonomyId,
  updateTermsById
} = require('../services/termService');

exports.create = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { taxonomyId, slug, title } = req.body;
    if (!taxonomyId || !slug || !title) {
      return res.status(400).json({ error: 'taxonomyId, slug, and title are required' });
    }

    const term = await createTerm(taxonomyId, slug, title);
    res.status(201).json(term);
  } catch (err) {
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
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getTermsByTaxonomyId = async (req, res) => {
  try {
    const { id } = req.params;
    const terms = await getTermsByTaxonomyId(id);
    res.json(terms);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
exports.updateByTermId = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { id } = req.params;  
    const { slug, title } = req.body;

    if (!id || !slug || !title) {
      return res.status(400).json({ error: 'id, slug, and title are required' });
    }

    const updatedTerm = await updateTermById(id, slug, title);
    if (!updatedTerm) {
      return res.status(404).json({ error: 'Term not found for given id' });
    }

    res.json(updatedTerm);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
