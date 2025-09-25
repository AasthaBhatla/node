const { getItems, createRelationship, updateRelationship, deleteRelationship } = require('../services/taxonomyService');

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
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createRelationship = async (req, res) => {
  try {
    const { term_id, taxonomy_id, type, type_id } = req.body;

    if (!term_id || !taxonomy_id || !type || !type_id) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const relationship = await createRelationship(term_id, taxonomy_id, type, type_id);
    res.status(201).json({ relationship });
  } catch (err) {
    console.error('Create Relationship Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateRelationship = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const updated = await updateRelationship(id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Relationship not found' });
    }

    res.json({ message: 'Relationship updated successfully', updated });
  } catch (err) {
    console.error('Update Relationship Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteRelationship = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await deleteRelationship(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Relationship not found' });
    }

    res.json({ message: 'Relationship deleted successfully', deleted });
  } catch (err) {
    console.error('Delete Relationship Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
