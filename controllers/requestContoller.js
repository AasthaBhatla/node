const requestService = require('../services/requestService');

exports.insertRequest = async (req, res) => {
  if (req.user.role !== 'Client') {
    return res.status(403).json({ error: 'Only clients can create requests' });
  }

  try {
    const data = { ...req.body, client_id: req.user.id };
    const request = await requestService.insertRequest(data);
    res.status(201).json(request);
  } catch (err) {
    console.error('Insert request error:', err);
    res.status(500).json({ error: 'Failed to create request' });
  }
};

exports.getRequestsByUser = async (req, res) => {
  try {
    const requests = await requestService.getRequestsByUser(req.user.id);
    res.json(requests);
  } catch (err) {
    console.error('Get my requests error:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

exports.getRequestById = async (req, res) => {
  const { id } = req.params;

  if (!['Admin', 'Partner'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const request = await requestService.getRequestById(id);
    res.json(request);
  } catch (err) {
    console.error('Get request by ID error:', err);
    res.status(500).json({ error: 'Failed to fetch request' });
  }
};
