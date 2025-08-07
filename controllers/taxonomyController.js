const {
  createTaxonomy,
  getAllTaxonomies,
  getTaxonomyById,
  updateTaxonomyById
} = require('../services/taxonomyService');

exports.getAll = async (req, res) => {
  try {
    const taxonomies = await getAllTaxonomies();
    res.json(taxonomies);
  } catch (err) {
    console.error('Get All Taxonomies Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const taxonomy = await getTaxonomyById(req.params.id);
    if (!taxonomy) {
      return res.status(404).json({ error: 'Taxonomy not found' });
    }
    res.json(taxonomy);
  } catch (err) {
    console.error('Get Taxonomy By ID Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.create = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { slug, title } = req.body;
    const newTaxonomy = await createTaxonomy(slug, title);
    res.status(201).json(newTaxonomy);
  } catch (err) {
    console.error('Create Taxonomy Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { slug, title } = req.body;
    const updated = await updateTaxonomyById(req.params.id, slug, title);

    if (!updated) {
      return res.status(404).json({ error: 'Taxonomy not found' });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update Taxonomy Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
