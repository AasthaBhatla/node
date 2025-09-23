const pool = require("../db");

const createOrder = async (orderData) => {
  try {
    const {
      user_id,
      status,
      line1,
      line2,
      city,
      state,
      pincode,
      phone,
    } = orderData;

    const result = await pool.query(
      `INSERT INTO orders (user_id, status, line1, line2, city, state, pincode, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [user_id, status || "pending", line1, line2, city, state, pincode, phone]
    );

    return result.rows[0];
  } catch (err) {
    console.error("Error in createOrder:", err);
    throw new Error("Error creating order");
  }
};

const getOrderById = async (id) => {
  try {
    const result = await pool.query(`SELECT * FROM orders WHERE order_id = $1`, [id]);
    return result.rows[0];
  } catch (err) {
    console.error("Error in getOrderById:", err);
    throw new Error("Error fetching order by ID");
  }
};

const getAllOrders = async () => {
  try {
    const result = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC`);
    return result.rows;
  } catch (err) {
    console.error("Error in getAllOrders:", err);
    throw new Error("Error fetching orders");
  }
};

const updateOrderById = async (id, updateData) => {
  try {
    const {
      status,
      line1,
      line2,
      city,
      state,
      pincode,
      phone,
    } = updateData;

    const result = await pool.query(
      `UPDATE orders
       SET status = COALESCE($1, status),
           line1 = COALESCE($2, line1),
           line2 = COALESCE($3, line2),
           city = COALESCE($4, city),
           state = COALESCE($5, state),
           pincode = COALESCE($6, pincode),
           phone = COALESCE($7, phone),
           created_at = created_at
       WHERE order_id = $8
       RETURNING *`,
      [status, line1, line2, city, state, pincode, phone, id]
    );

    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in updateOrderById:", err);
    throw new Error("Error updating order");
  }
};

const deleteOrderById = async (id) => {
  try {
    const result = await pool.query(`DELETE FROM orders WHERE order_id = $1 RETURNING *`, [id]);
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in deleteOrderById:", err);
    throw new Error("Error deleting order");
  }
};

module.exports = {
  createOrder,
  getOrderById,
  getAllOrders,
  updateOrderById,
  deleteOrderById,
};
