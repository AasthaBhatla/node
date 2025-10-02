const {
  createTaxonomy,
  getAllTaxonomies,
  getTaxonomyById,
  updateTaxonomyById,
  removeTypeFromTaxonomy
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

    if (!user) return res.status(401).json({ error: 'User not authenticated' });
    if (!user.role || user.role.toLowerCase() !== 'admin') 
      return res.status(403).json({ error: 'Access denied. Admins only.' });

    let { slug, title } = req.body;

    if (!slug || slug.includes(' ')) {
      return res.status(400).json({ error: 'Slug is required and must not contain spaces.' });
    }

    slug = slug.toLowerCase().replace(/\s+/g, '-');

    const newTaxonomy = await createTaxonomy(slug, title);
    res.status(201).json(newTaxonomy);

  } catch (err) {
    if (err.code === '23505') 
      return res.status(409).json({ error: 'Slug already exists.' });
    console.error('Create Taxonomy Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { slug, title, type } = req.body;

    const existing = await getTaxonomyById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Taxonomy not found' });
    }

    let newSlug = typeof slug === 'undefined' ? existing.slug : slug;
    let newTitle = typeof title === 'undefined' ? existing.title : title;

    if (!newSlug || newSlug.includes(' ')) {
      return res.status(400).json({ error: 'Slug is required and must not contain spaces.' });
    }
    newSlug = newSlug.toLowerCase().replace(/\s+/g, '-');

    if (typeof type !== 'undefined' && type !== null && !Array.isArray(type)) {
      return res.status(400).json({ error: 'Type must be an array of strings.' });
    }

    const updated = await updateTaxonomyById(req.params.id, newSlug, newTitle, type);

    if (!updated) {
      return res.status(404).json({ error: 'Taxonomy not found' });
    }

    res.json(updated);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Slug already exists.' });
    }
    console.error('Update Taxonomy Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteType = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { type } = req.body;
    if (!type || typeof type !== 'string') {
      return res.status(400).json({ error: 'Type value (string) is required in body to delete.' });
    }

    const updated = await removeTypeFromTaxonomy(req.params.id, type);

    if (!updated) {
      return res.status(404).json({ error: 'Taxonomy not found' });
    }

    res.json(updated);
  } catch (err) {
    console.error('Delete Type Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};