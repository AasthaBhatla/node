/*
const pool = require("../db");

const createBanner = async (banner_url, banner_title, alt_text, position, action) => {
  try {
    const query = `
      INSERT INTO banners (banner_url, banner_title, alt_text, position, action)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const values = [banner_url, banner_title, alt_text, position, action];
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (err) {
    console.error("Error in createBanner:", err);
    throw new Error("Error creating banner");
  }
};

const getBanners = async () => {
  try {
    const query = `SELECT * FROM banners ORDER BY created_at DESC;`;
    const { rows } = await pool.query(query);
    return rows;
  } catch (err) {
    console.error("Error in getBanners:", err);
    throw new Error("Error fetching banners");
  }
};

const getBannerById = async (id) => {
  try {
    const query = `SELECT * FROM banners WHERE id = $1;`;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  } catch (err) {
    console.error("Error in getBannerById:", err);
    throw new Error("Error fetching banner by ID");
  }
};

const updateBanner = async (id, banner_url, banner_title, alt_text, position, action, is_active) => {
  try {
    const query = `
      UPDATE banners
      SET banner_url = $1,
          banner_title = $2,
          alt_text = $3,
          position = $4,
          action = $5,
          is_active = $6,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *;
    `;
    const values = [banner_url, banner_title, alt_text, position, action, is_active, id];
    const { rows } = await pool.query(query, values);
    return rows[0] || null;
  } catch (err) {
    console.error("Error in updateBanner:", err);
    throw new Error("Error updating banner");
  }
};


const deleteBanner = async (id) => {
  try {
    const query = `DELETE FROM banners WHERE id = $1 RETURNING *;`;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  } catch (err) {
    console.error("Error in deleteBanner:", err);
    throw new Error("Error deleting banner");
  }
};

module.exports = {
  createBanner,
  getBanners,
  getBannerById,
  updateBanner,
  deleteBanner,
};
*/