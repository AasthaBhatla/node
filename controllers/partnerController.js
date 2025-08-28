const {
  getAllPartners,
  getPartnerById,
  getPartnerFilters,
  checkPartnerAvailability,
  getPartnerReviews,
  getPartnerRatings,
  getFeaturedPartners
} = require('../services/partnerService');

exports.getAll = async (req, res) => {
  try {
    const authUser = req.user; 
    const { search } = req.query;
    const partners = await getAllPartners(authUser, search);
    res.json(partners);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const authUser = req.user;
    const { id } = req.params;
    const partner = await getPartnerById(authUser, id);
    if (!partner) return res.status(404).json({ error: 'Partner not found' });
    res.json(partner);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
};

exports.checkAvailability = async (req, res) => {
  try {
    const authUser = req.user;
    const { id } = req.params;
    const availability = await checkPartnerAvailability(authUser, id);
    if (!availability || availability.length === 0) {
      return res.status(404).json({ error: 'Partner not available' });
    }
    res.json(availability);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
};

exports.getReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const reviews = await getPartnerReviews(id);
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getRatings = async (req, res) => {
  try {
    const { id } = req.params;
    const ratings = await getPartnerRatings(id);
    res.json(ratings);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getFeatured = async (req, res) => {
  try {
    const partners = await getFeaturedPartners();
    res.json(partners);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getFilters = async (req, res) => {
  try {
    const filters = await getPartnerFilters(req.query);
    res.json(filters);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

