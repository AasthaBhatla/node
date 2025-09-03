const pool = require('../db');

const createProduct = async (title, description, date, time, featuredImageUrl) => {
  try {
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; 
    const currentTime = now.toTimeString().split(' ')[0]; 

    const finalDate = date || currentDate;
    const finalTime = time || currentTime;

    const result = await pool.query(
      `INSERT INTO products (title, description, date, time, featured_image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, description, finalDate, finalTime, featuredImageUrl]
    );
    return result.rows[0];
  } catch (err) {
    console.error('Error in createProduct:', err);
    throw new Error('Error creating product');
  }
};

const getProductById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT * FROM products WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  } catch (err) {
    console.error('Error in getProductById:', err);
    throw new Error('Error fetching product by ID');
  }
};

const getAllProducts = async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM products ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (err) {
    console.error('Error in getAllProducts:', err);
    throw new Error('Error fetching products');
  }
};

const updateProductById = async (id, title, description, date, time, featuredImageUrl) => {
  try {
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0];

    const finalDate = date || currentDate;
    const finalTime = time || currentTime;

    const query = `
      UPDATE products
      SET title = $1,
          description = $2,
          date = $3,
          time = $4,
          featured_image_url = $5,
          updated_at = NOW()
      WHERE id = $6
      RETURNING *;
    `;
    const values = [title, description, finalDate, finalTime, featuredImageUrl, id];
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  } catch (err) {
    console.error('Error in updateProductById:', err);
    throw new Error('Error updating product');
  }
};

const deleteProductById = async (id) => {
  try {
    const result = await pool.query(
      `DELETE FROM products WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('Error in deleteProductById:', err);
    throw new Error('Error deleting product');
  }
};

module.exports = {
  createProduct,
  getProductById,
  getAllProducts,
  updateProductById,
  deleteProductById
};
