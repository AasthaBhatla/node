const pool = require("../db");

const createOrderItem = async (orderId, productId, quantity, notes) => {
  try {
    const result = await pool.query(
      `INSERT INTO order_items (order_id, product_id, quantity, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [orderId, productId, quantity, notes]
    );
    return result.rows[0];
  } catch (err) {
    console.error("Error in createOrderItem:", err);
    throw new Error("Error creating order item");
  }
};

const getOrderItemById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT * FROM order_items WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  } catch (err) {
    console.error("Error in getOrderItemById:", err);
    throw new Error("Error fetching order item by ID");
  }
};

const getAllOrderItems = async () => {
  try {
    const result = await pool.query(`SELECT * FROM order_items`);
    return result.rows;
  } catch (err) {
    console.error("Error in getAllOrderItems:", err);
    throw new Error("Error fetching order items");
  }
};

const updateOrderItemById = async (id, quantity, notes) => {
  try {
    const result = await pool.query(
      `UPDATE order_items
       SET quantity = $1, notes = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [quantity, notes, id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in updateOrderItemById:", err);
    throw new Error("Error updating order item");
  }
};

const deleteOrderItemById = async (id) => {
  try {
    const result = await pool.query(
      `DELETE FROM order_items WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in deleteOrderItemById:", err);
    throw new Error("Error deleting order item");
  }
};

module.exports = {
  createOrderItem,
  getOrderItemById,
  getAllOrderItems,
  updateOrderItemById,
  deleteOrderItemById
};
