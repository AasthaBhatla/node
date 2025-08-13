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
    const { search } = req.query;
    const partners = await getAllPartners(search);
    res.json(partners);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const partner = await getPartnerById(id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner not found' });
    }
    res.json(partner);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getFilters = async (req, res) => {
  try {
    const filters = await getPartnerFilters(req.query); 
    res.json(filters);
  } catch (err) {
    console.error('Error in getFilters:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.checkAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const availability = await checkPartnerAvailability(id);
    if (!availability) {
      return res.status(404).json({ error: 'Partner not found or availability not set' });
    }
    res.json(availability);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const reviews = await getPartnerReviews(id);
    if (!reviews) {
      return res.status(404).json({ error: 'No reviews found' });
    }
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getRatings = async (req, res) => {
  try {
    const { id } = req.params;
    const ratings = await getPartnerRatings(id);
    if (!ratings) {
      return res.status(404).json({ error: 'No ratings found' });
    }
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
