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
exports.updateRequestById = async (req, res) => {
  const { id } = req.params;

  if (!['Admin', 'Client'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const updated = await requestService.updateRequestById(id, req.body);
    res.json(updated);
  } catch (err) {
    console.error('Update request error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
};

exports.assignPartner = async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only admins can assign requests' });
  }

  try {
    const { request_id, partner_id } = req.body;
    const assigned = await requestService.assignPartner(request_id, partner_id);
    res.json(assigned);
  } catch (err) {
    console.error('Assign partner error:', err);
    res.status(500).json({ error: 'Failed to assign partner' });
  }
};

exports.acceptRequest = async (req, res) => {
  if (req.user.role !== 'Partner') {
    return res.status(403).json({ error: 'Only partners can accept requests' });
  }

  try {
    const { request_id } = req.body;
    const accepted = await requestService.acceptRequest(request_id, req.user.id);
    res.json(accepted);
  } catch (err) {
    console.error('Accept request error:', err);
    res.status(500).json({ error: 'Failed to accept request' });
  }
};

exports.rejectRequest = async (req, res) => {
  if (req.user.role !== 'Partner') {
    return res.status(403).json({ error: 'Only partners can reject requests' });
  }

  try {
    const { request_id } = req.body;
    const rejected = await requestService.rejectRequest(request_id, req.user.id);
    res.json(rejected);
  } catch (err) {
    console.error('Reject request error:', err);
    res.status(500).json({ error: 'Failed to reject request' });
  }
};

exports.updateStatus = async (req, res) => {
  const { id } = req.params;

  if (!['Partner', 'Admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const updated = await requestService.updateStatus(id, req.body.status);
    res.json(updated);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
};

exports.getAllRequestCategories = async (req, res) => {
  try {
    const categories = await requestService.getAllRequestCategories();
    res.json(categories);
  } catch (err) {
    console.error('Fetch categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
};

exports.deleteRequest = async (req, res) => {
  const { id } = req.params;

  if (!['Admin', 'Client'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const deleted = await requestService.deleteRequest(id);
    res.json({ message: 'Request deleted successfully', result: deleted });
  } catch (err) {
    console.error('Delete request error:', err);
    res.status(500).json({ error: 'Failed to delete request' });
  }
};