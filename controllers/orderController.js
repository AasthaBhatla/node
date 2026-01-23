// controllers/orderController.js
const orderService = require("../services/orderService");

const parsePosInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

exports.create = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // ✅ Never trust user_id from client
    // We pass userId separately so orderService never needs user_id from req.body
    const data = await orderService.createOrder(userId, req.body);

    return res.json(data);
  } catch (err) {
    console.error("Error in order create:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};

exports.listMine = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const orders = await orderService.getOrdersForUser(userId);
    return res.json({ orders });
  } catch (err) {
    console.error("Error in order listMine:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};

exports.getMineById = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const orderId = parsePosInt(req.params.order_id);
    if (!orderId) return res.status(400).json({ error: "Invalid order_id" });

    const order = await orderService.getOrderByIdForUser(orderId, userId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    return res.json({ order });
  } catch (err) {
    console.error("Error in order getMineById:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};

exports.getMyPaymentStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const orderId = parsePosInt(req.params.order_id);
    if (!orderId) return res.status(400).json({ error: "Invalid order_id" });

    const data = await orderService.getOrderPaymentStatusForUser(
      orderId,
      userId,
    );
    return res.json(data);
  } catch (err) {
    console.error("Error in order getMyPaymentStatus:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};

exports.cancelMine = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const orderId = parsePosInt(req.params.order_id);
    if (!orderId) return res.status(400).json({ error: "Invalid order_id" });

    const data = await orderService.cancelOrderForUser(orderId, userId);
    return res.json(data);
  } catch (err) {
    console.error("Error in order cancelMine:", err);
    const status = err.statusCode || 500;
    return res
      .status(status)
      .json({ error: err.message || "Internal server error" });
  }
};
