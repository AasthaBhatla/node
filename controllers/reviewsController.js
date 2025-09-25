const {
  createReview,
  getReviews,
  getReviewById,
  updateReview,
  deleteReview,
} = require('../services/reviewsService');

exports.create = async (req, res) => {
  try {
    const { type, type_id, review, ratings } = req.body;
    const reviewer_id = req.user.id;

    if (!type || !type_id || !review || ratings == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const newReview = await createReview({ reviewer_id, type, type_id, review, ratings });
    res.status(201).json(newReview);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { type, type_id } = req.query;
    const filters = {};
    if (type) filters.type = type;
    if (type_id) filters.type_id = parseInt(type_id);

    const reviews = await getReviews(filters);
    res.json(reviews);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const review = await getReviewById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    res.json(review);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const { review, ratings } = req.body;
    const updated = await updateReview(req.params.id, { review, ratings });
    if (!updated) return res.status(404).json({ error: 'Review not found' });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.delete = async (req, res) => {
  try {
    const deletedCount = await deleteReview(req.params.id);
    if (!deletedCount) return res.status(404).json({ error: 'Review not found' });
    res.json({ message: 'Review deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
