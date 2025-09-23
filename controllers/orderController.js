const {
  createOrder,
  getOrderById,
  getAllOrders,
  updateOrderById,
  deleteOrderById,
} = require("../services/orderService");


exports.create = async (req, res) => {
  try {
    const order = await createOrder(req.body);
    res.status(201).json(order);
  } catch (err) {
    console.error("Error in create order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await getOrderById(id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    console.error("Error in getById order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getAll = async (req, res) => {
  try {
    const orders = await getAllOrders();
    res.json(orders);
  } catch (err) {
    console.error("Error in getAll orders:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.updateById = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedOrder = await updateOrderById(id, req.body);
    if (!updatedOrder) return res.status(404).json({ error: "Order not found" });
    res.json(updatedOrder);
  } catch (err) {
    console.error("Error in updateById order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteById = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedOrder = await deleteOrderById(id);
    if (!deletedOrder) return res.status(404).json({ error: "Order not found" });

    res.json({ message: "Order deleted successfully", deletedOrder });
  } catch (err) {
    console.error("Error in deleteById order:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
