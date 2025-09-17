const {
  createOrderItem,
  getOrderItemById,
  getAllOrderItems,
  updateOrderItemById,
  deleteOrderItemById
} = require("../services/orderItemService");

exports.create = async (req, res) => {
  try {
    const { orderId, productId, productIds, quantity, quantities, notes } = req.body;

    if (!orderId || (!productId && (!Array.isArray(productIds) || productIds.length === 0))) {
      return res.status(400).json({ error: "orderId and productId(s) are required" });
    }

    let orderItems = await createOrderItem(
      orderId,
      productId || productIds,   
      quantity || quantities,    
      notes || null             
    );

    if (!Array.isArray(orderItems)) {
      orderItems = [orderItems];
    }

    res.status(201).json(orderItems);
  } catch (err) {
    console.error("Error in create order item(s):", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const orderItem = await getOrderItemById(id);
    if (!orderItem) {
      return res.status(404).json({ error: "Order item not found" });
    }
    res.json(orderItem);
  } catch (err) {
    console.error("Error in getById order item:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getAll = async (req, res) => {
  try {
    const orderItems = await getAllOrderItems();
    res.json(orderItems);
  } catch (err) {
    console.error("Error in getAll order items:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.updateById = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, notes } = req.body;

    if (!quantity) {
      return res.status(400).json({ error: "quantity is required" });
    }

    const updatedOrderItem = await updateOrderItemById(id, quantity, notes || null);
    if (!updatedOrderItem) {
      return res.status(404).json({ error: "Order item not found" });
    }

    res.json(updatedOrderItem);
  } catch (err) {
    console.error("Error in updateById order item:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteById = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedOrderItem = await deleteOrderItemById(id);
    if (!deletedOrderItem) {
      return res.status(404).json({ error: "Order item not found" });
    }

    res.json({ message: "Order item deleted successfully", deletedOrderItem });
  } catch (err) {
    console.error("Error in deleteById order item:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
