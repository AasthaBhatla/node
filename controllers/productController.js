const {
  createProduct,
  getProductById,
  getAllProducts,
  updateProductById,
  deleteProductById
} = require('../services/productService');

exports.create = async (req, res) => {
  try {
    const { title, description, date, time, featuredImageUrl } = req.body;

    if (!title || !featuredImageUrl) {
      return res.status(400).json({ error: 'title and featuredImageUrl are required' });
    }

    const product = await createProduct(title, description || null, date, time, featuredImageUrl);
    res.status(201).json(product);
  } catch (err) {
    console.error('Error in create:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await getProductById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (err) {
    console.error('Error in getById:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getAll = async (req, res) => {
  try {
    const products = await getAllProducts();
    res.json(products);
  } catch (err) {
    console.error('Error in getAll:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, date, time, featuredImageUrl } = req.body;

    if (!id || !title || !featuredImageUrl) {
      return res.status(400).json({ error: 'id, title, and featuredImageUrl are required' });
    }

    const updatedProduct = await updateProductById(id, title, description || null, date, time, featuredImageUrl);
    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found for given id' });
    }

    res.json(updatedProduct);
  } catch (err) {
    console.error('Error in update:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedProduct = await deleteProductById(id);
    if (!deletedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error in delete:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
