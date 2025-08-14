const requestService = require('../services/requestService');

exports.insertRequest = async (req, res) => {
  try {
    if (!['client', 'admin'].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: 'Access denied' });
    }
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
    if (!['client', 'admin', 'lawyer', 'expert'].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const requests = await requestService.getRequestsByUser(req.user.id);
    res.json(requests);
  } catch (err) {
    console.error('Get my requests error:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

exports.getRequestById = async (req, res) => {
  try {
    if (!['client', 'admin', 'lawyer', 'expert'].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const request = await requestService.getRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    res.json(request);
  } catch (err) {
    console.error('Get request by ID error:', err);
    res.status(500).json({ error: 'Failed to fetch request' });
  }
};

exports.updateRequestById = async (req, res) => {
  try {
    if (!['client', 'admin'].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const updated = await requestService.updateRequestById(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    console.error('Update request error:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
};

exports.assignPartner = async (req, res) => {
  try {
    if (req.user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id, partner_id } = req.body;
    if (!id || !partner_id) {
      return res.status(400).json({ error: 'id and partner_id are required' });
    }

    const assigned = await requestService.assignPartner(id, partner_id);
    res.json(assigned);

  } catch (err) {
    console.error('Assign partner error:', err);
    res.status(500).json({ error: 'Failed to assign partner' });
  }
};

exports.acceptRequest = async (req, res) => {
  try {
    if (!['lawyer', 'expert'].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.body;
    const accepted = await requestService.acceptRequest(id, req.user.id);

    if (accepted) {
      return res.status(200).json({
        success: true,
        message: 'Request accepted successfully',
        affectedRows: accepted
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'No matching request found or already accepted'
      });
    }
  } catch (err) {
    console.error('Accept request error:', err);
    res.status(500).json({ error: 'Failed to accept request' });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    if (!req.user || !req.user.role || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized: missing user information' });
    }

    if (!['lawyer', 'expert'].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Request ID is required' });
    }

    const rejected = await requestService.rejectRequest(id,req.user.id);

    if (rejected) {
      return res.status(200).json({
        success: true,
        message: 'Request rejected successfully',
        data: rejected
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'Request not found or already rejected'
      });
    }
  } catch (err) {
    console.error('Reject request error:', err);
    res.status(500).json({ error: 'Failed to reject request' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    if (!['admin', 'lawyer', 'expert'].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const updated = await requestService.updateStatus(req.params.id, req.body.status);
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
  try {
    if (!['client', 'admin'].includes(req.user.role.toLowerCase())) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const deleted = await requestService.deleteRequest(req.params.id);
    res.json({ message: 'Request deleted successfully', result: deleted });
  } catch (err) {
    console.error('Delete request error:', err);
    res.status(500).json({ error: 'Failed to delete request' });
  }
};
