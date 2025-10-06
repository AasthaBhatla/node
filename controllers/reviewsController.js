const {
  createReview,
  getAllReviews,
  getReviewById,
  updateReviewById,
  deleteReviewById,
} = require('../services/reviewsService');

exports.create = async (req, res) => {
  try {
    const reviewer_id = req.user?.id;
    const { type, type_id, review, ratings, metadata, status } = req.body;

    if (!reviewer_id || !type || !type_id || !review || ratings == null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const metaObject = metadata && typeof metadata === 'object' ? metadata : {};
    const validStatuses = ['pending', 'approved', 'rejected'];
    const reviewStatus = validStatuses.includes(status) ? status : 'pending';

    const newReview = await createReview(
      reviewer_id,
      type,
      type_id,
      review,
      ratings,
      reviewStatus,
      metaObject
    );

    return res.status(201).json(newReview);
  } catch (err) {
    console.error('Create Review Error:', err);
    return res.status(500).json({ error: 'Failed to create review' });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { type, type_id, status } = req.query;
    const filters = {};
    if (type) filters.type = type;
    if (type_id) filters.type_id = parseInt(type_id);
    if (status) filters.status = status;

    const reviews = await getAllReviews(filters);
    return res.status(200).json({ reviews });
  } catch (err) {
    console.error('Get All Reviews Error:', err);
    return res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};

exports.getById = async (req, res) => {
  const review_id = req.params.id;
  try {
    const review = await getReviewById(review_id);
    if (!review) return res.status(404).json({ error: 'Review not found' });

    return res.status(200).json(review);
  } catch (err) {
    console.error('Get Review By ID Error:', err);
    return res.status(500).json({ error: 'Failed to fetch review' });
  }
};

exports.update = async (req, res) => {
  const review_id = req.params.id;
  const { review, ratings, metadata, status } = req.body;

  try {
    const metaObject = metadata && typeof metadata === 'object' ? metadata : {};
    const updatedReview = await updateReviewById(
      review_id,
      review,
      ratings,
      status,
      metaObject
    );

    if (!updatedReview) return res.status(404).json({ error: 'Review not found' });

    return res.status(200).json(updatedReview);
  } catch (err) {
    console.error('Update Review Error:', err);
    return res.status(500).json({ error: 'Failed to update review' });
  }
};

exports.remove = async (req, res) => {
  const review_id = req.params.id;

  try {
    const deletedReview = await deleteReviewById(review_id);
    if (!deletedReview) return res.status(404).json({ error: 'Review not found' });

    return res.status(200).json({ message: 'Review deleted successfully' });
  } catch (err) {
    console.error('Delete Review Error:', err);
    return res.status(500).json({ error: 'Failed to delete review' });
  }
};
