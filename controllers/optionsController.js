const {
  createOption,
  getOptions,
  updateOptions,
  deleteOption
} = require('../services/optionsService');

exports.create = async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || !value) {
      return res.status(400).json({ error: 'Key and value are required' });
    }
    const option = await createOption(key, value);
    res.status(201).json(option);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Key already exists' });
    }
    console.error('Create Option Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.get = async (req, res) => {
  try {
    let keys = req.query.keys; 
    if (keys) {
      keys = keys.split(',');
    }
    const options = await getOptions(keys);
    res.json(options);
  } catch (err) {
    console.error('Get Options Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const updates = req.body; 
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Updates must be a non-empty array' });
    }
    const updated = await updateOptions(updates);
    res.json(updated);
  } catch (err) {
    console.error('Update Options Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.delete = async (req, res) => {
  try {
    const { key } = req.params;
    const deleted = await deleteOption(key);
    if (!deleted) {
      return res.status(404).json({ error: 'Option not found' });
    }
    res.json(deleted);
  } catch (err) {
    console.error('Delete Option Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
