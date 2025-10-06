const { 
  getItems, 
  createRelationship, 
  updateRelationship, 
  deleteRelationship 
} = require('../services/relationshipService');

const authMiddleware = require('../middlewares/authMiddleware');

exports.getItems = async (req, res) => {
  try {
    const { taxonomy_id, type_id, type } = req.query;
    const filters = {};

    if (taxonomy_id) filters.taxonomy_id = parseInt(taxonomy_id);
    if (type_id) filters.type_id = parseInt(type_id);
    if (type) filters.type = type;

    const items = await getItems(filters);
    res.json({ items });
  } catch (err) {
    console.error('Get Items Error:', err);
    res.status(500).json({ error: 'Error fetching items' });
  }
};

exports.createRelationship = [
  authMiddleware,
  async (req, res) => {
    try {
      const data = Array.isArray(req.body) ? req.body : [req.body];
      const invalid = data.find(r => !r.term_id || !r.taxonomy_id || !r.type || !r.type_id);
      if (invalid) {
        return res.status(400).json({ error: 'All fields are required for every relationship' });
      }

      const created = await createRelationship(data);
      res.status(201).json({ relationships: created });
    } catch (err) {
      console.error('Create Relationship Error:', err);
      res.status(500).json({ error: 'Error creating relationship' });
    }
  }
];

exports.updateRelationship = [
  authMiddleware,
  async (req, res) => {
    try {
      const data = Array.isArray(req.body) ? req.body : [req.body];
      const updated = await updateRelationship(data);
      res.json({ message: 'Relationships replaced successfully', updated });
    } catch (err) {
      console.error('Update Relationship Error:', err);
      res.status(500).json({ error: 'Error updating relationship' });
    }
  }
];

exports.deleteRelationship = [
  authMiddleware,
  async (req, res) => {
    try {
      const ids = Array.isArray(req.body) ? req.body : [req.body.id];
      const deleted = await deleteRelationship(ids);
      res.json({ message: 'Relationships deleted successfully', deleted });
    } catch (err) {
      console.error('Delete Relationship Error:', err);
      res.status(500).json({ error: 'Error deleting relationship' });
    }
  }
];
