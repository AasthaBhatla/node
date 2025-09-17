/*
const {
  createBanner,
  getBanners,
  getBannerById,
  updateBanner,
  deleteBanner
} = require('../services/bannerService');

exports.getAll = async (req, res) => {
  try {
    const banners = await getBanners();
    res.json(banners);
  } catch (err) {
    console.error('Get All Banners Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const banner = await getBannerById(req.params.id);
    if (!banner) {
      return res.status(404).json({ error: 'Banner not found' });
    }
    res.json(banner);
  } catch (err) {
    console.error('Get Banner By ID Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.create = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { banner_url, banner_title, alt_text, position, action } = req.body;

    if (!banner_url || !banner_title || !position) {
      return res.status(400).json({ error: 'banner_url, banner_title, and position are required.' });
    }

    const newBanner = await createBanner(banner_url, banner_title, alt_text, position, action);
    res.status(201).json(newBanner);

  } catch (err) {
    console.error('Create Banner Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const { banner_url, banner_title, alt_text, position, action, is_active } = req.body;
    const updated = await updateBanner(req.params.id, banner_url, banner_title, alt_text, position, action, is_active);

    if (!updated) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update Banner Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.delete = async (req, res) => {
  try {
    const user = req.user;
    if (user.role.toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admins only.' });
    }

    const deleted = await deleteBanner(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    res.json({ message: 'Banner deleted successfully', deleted });
  } catch (err) {
    console.error('Delete Banner Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
*/