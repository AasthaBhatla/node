const pool = require("../db");
const razorpay = require("../utils/razorpay");

const assertPosInt = (v) => Number.isInteger(v) && v > 0;

const createOrder = async (userId, orderData) => {
  const client = await pool.connect();

  try {
    const { status } = orderData || {};

    const userIdParsed = parseInt(userId, 10);

    if (!assertPosInt(userIdParsed)) {
      const e = new Error("Invalid authenticated user");
      e.statusCode = 400;
      throw e;
    }

    const u = await client.query(`SELECT id FROM users WHERE id = $1`, [
      userIdParsed,
    ]);
    if (!u.rows[0]) {
      const e = new Error("User not found");
      e.statusCode = 404;
      throw e;
    }

    const items = orderData?.items;
    const hasItems = Array.isArray(items) && items.length > 0;

    const directAmountRaw = orderData?.direct_amount_paise;
    const directAmountParsed =
      directAmountRaw == null ? null : parseInt(directAmountRaw, 10);

    // Accept numbers or numeric strings from frontend
    const hasDirectAmount =
      Number.isInteger(directAmountParsed) && directAmountParsed > 0;

    // Exactly one mode
    if (hasItems && hasDirectAmount) {
      const e = new Error(
        "Provide either items OR direct_amount_paise, not both",
      );
      e.statusCode = 400;
      throw e;
    }
    if (!hasItems && !hasDirectAmount) {
      const e = new Error(
        "Either items (product mode) or direct_amount_paise (custom mode) is required",
      );
      e.statusCode = 400;
      throw e;
    }

    // Totals computed server-side
    let total_amount_paise = 0;
    let credits_to_grant = 0;

    // Optional note (custom mode only, but safe to accept generally)
    const order_note = orderData?.note ? String(orderData.note) : null;

    let createdOrder = null;

    await client.query("BEGIN");

    if (hasItems) {
      // ---------- PRODUCT MODE (credit packs) ----------
      const cleanedItems = items
        .filter((it) => it && typeof it === "object")
        .map((it) => ({
          product_id: parseInt(it.product_id, 10),
          quantity: it.quantity == null ? 1 : parseInt(it.quantity, 10),
          notes: it.notes ? String(it.notes) : null,
        }))
        .filter(
          (it) => assertPosInt(it.product_id) && assertPosInt(it.quantity),
        );

      if (cleanedItems.length === 0) {
        const e = new Error("items must contain valid product_id and quantity");
        e.statusCode = 400;
        throw e;
      }

      const productIds = [...new Set(cleanedItems.map((i) => i.product_id))];

      const productsRes = await client.query(
        `SELECT id, price_paise, credits_grant, is_active
         FROM products
         WHERE id = ANY($1::int[])`,
        [productIds],
      );

      const productMap = new Map(productsRes.rows.map((p) => [p.id, p]));

      // compute totals + validate
      for (const it of cleanedItems) {
        const p = productMap.get(it.product_id);

        if (!p) {
          const e = new Error(`Invalid product_id: ${it.product_id}`);
          e.statusCode = 400;
          throw e;
        }
        if (!p.is_active) {
          const e = new Error(`Product is not active: ${it.product_id}`);
          e.statusCode = 400;
          throw e;
        }
        if (!Number.isInteger(p.price_paise) || p.price_paise <= 0) {
          const e = new Error(
            `Product has invalid price_paise: ${it.product_id}`,
          );
          e.statusCode = 400;
          throw e;
        }
        if (!Number.isInteger(p.credits_grant) || p.credits_grant <= 0) {
          const e = new Error(
            `Product has invalid credits_grant: ${it.product_id}`,
          );
          e.statusCode = 400;
          throw e;
        }

        total_amount_paise += p.price_paise * it.quantity;
        credits_to_grant += p.credits_grant * it.quantity;
      }

      // Insert order
      const orderRes = await client.query(
        `INSERT INTO orders (
            user_id, status, total_amount_paise, credits_to_grant, payment_provider
         )
         VALUES ($1, $2, $3, $4, 'razorpay')
         RETURNING *`,
        [
          userIdParsed,
          status || "pending",
          total_amount_paise,
          credits_to_grant,
        ],
      );

      createdOrder = orderRes.rows[0];

      // Insert order items with snapshots
      for (const it of cleanedItems) {
        const p = productMap.get(it.product_id);

        await client.query(
          `INSERT INTO order_items (
              order_id, product_id, quantity, notes, unit_price_paise, credits_grant
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            createdOrder.order_id,
            it.product_id,
            it.quantity,
            it.notes,
            p.price_paise,
            p.credits_grant,
          ],
        );
      }
    } else {
      // ---------- CUSTOM AMOUNT MODE ----------
      const direct_amount_paise = parseInt(orderData.direct_amount_paise, 10);

      if (!assertPosInt(direct_amount_paise)) {
        const e = new Error(
          "direct_amount_paise must be a positive integer (in paise)",
        );
        e.statusCode = 400;
        throw e;
      }

      total_amount_paise = direct_amount_paise;

      // ✅ 1 rupee = 1 credit
      credits_to_grant = Math.floor(total_amount_paise / 100);

      const order_note = orderData?.note ? String(orderData.note) : null;

      const orderRes = await client.query(
        `INSERT INTO orders (
      user_id, status, total_amount_paise, credits_to_grant,
      direct_amount_paise, order_note, payment_provider
   )
   VALUES ($1, $2, $3, $4, $5, $6, 'razorpay')
   RETURNING *`,
        [
          userIdParsed,
          status || "pending",
          total_amount_paise,
          credits_to_grant,
          direct_amount_paise,
          order_note,
        ],
      );

      createdOrder = orderRes.rows[0];
    }

    await client.query("COMMIT");

    // Create Razorpay order (external call after DB commit)
    const rpOrder = await razorpay.orders.create({
      amount: total_amount_paise, // paise
      currency: "INR",
      receipt: `order_${createdOrder.order_id}`,
      notes: {
        internal_order_id: String(createdOrder.order_id),
        user_id: String(createdOrder.user_id),
        credits_to_grant: String(credits_to_grant),
        mode: hasItems ? "product" : "custom",
      },
    });

    // Save razorpay_order_id
    const updatedOrderRes = await pool.query(
      `UPDATE orders
       SET razorpay_order_id = $1
       WHERE order_id = $2
       RETURNING *`,
      [rpOrder.id, createdOrder.order_id],
    );

    return {
      order: updatedOrderRes.rows[0],
      razorpay: {
        key_id: process.env.RAZORPAY_KEY_ID,
        order_id: rpOrder.id,
        amount: rpOrder.amount,
        currency: rpOrder.currency,
      },
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    console.error("Error in createOrder:", err);
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
};

const getOrdersForUser = async (userId) => {
  const result = await pool.query(
    `SELECT
       order_id, user_id, status, total_amount_paise, credits_to_grant, credits_granted,
       razorpay_order_id, razorpay_payment_id, paid_at, created_at
     FROM orders
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
};

const getOrderByIdForUser = async (orderId, userId) => {
  const result = await pool.query(
    `SELECT
       order_id, user_id, status, total_amount_paise, credits_to_grant, credits_granted,
       razorpay_order_id, razorpay_payment_id, paid_at, created_at
     FROM orders
     WHERE order_id = $1 AND user_id = $2`,
    [orderId, userId],
  );

  const order = result.rows[0] || null;
  if (!order) return null;

  // Optional: include items for product-mode orders
  const itemsRes = await pool.query(
    `SELECT id, product_id, quantity, unit_price_paise, credits_grant, notes, created_at
     FROM order_items
     WHERE order_id = $1
     ORDER BY id ASC`,
    [orderId],
  );

  return { ...order, items: itemsRes.rows };
};

const getOrderPaymentStatusForUser = async (orderId, userId) => {
  const result = await pool.query(
    `SELECT
       order_id, user_id, status, total_amount_paise, credits_to_grant, credits_granted,
       razorpay_order_id, razorpay_payment_id, paid_at, created_at
     FROM orders
     WHERE order_id = $1 AND user_id = $2`,
    [orderId, userId],
  );

  const order = result.rows[0];
  if (!order) {
    const e = new Error("Order not found");
    e.statusCode = 404;
    throw e;
  }

  return {
    order,
    payment: {
      is_paid: order.status === "completed" && !!order.paid_at,
      is_credited: !!order.credits_granted,
      credits_to_grant: order.credits_to_grant,
    },
  };
};

const cancelOrderForUser = async (orderId, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock row
    const res = await client.query(
      `SELECT * FROM orders WHERE order_id = $1 AND user_id = $2 FOR UPDATE`,
      [orderId, userId],
    );

    const order = res.rows[0];
    if (!order) {
      const e = new Error("Order not found");
      e.statusCode = 404;
      throw e;
    }

    // If already paid, do not allow cancel
    if (order.paid_at || order.status === "completed") {
      const e = new Error("Paid orders cannot be cancelled");
      e.statusCode = 400;
      throw e;
    }

    // Only pending/processing can be cancelled (your call)
    if (!["pending", "processing", "hold"].includes(order.status)) {
      const e = new Error(
        `Order cannot be cancelled in status: ${order.status}`,
      );
      e.statusCode = 400;
      throw e;
    }

    const updated = await client.query(
      `UPDATE orders
       SET status = 'cancelled'
       WHERE order_id = $1
       RETURNING
         order_id, user_id, status, total_amount_paise, credits_to_grant, credits_granted,
         razorpay_order_id, razorpay_payment_id, paid_at, created_at`,
      [orderId],
    );

    await client.query("COMMIT");

    return { message: "Order cancelled", order: updated.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  createOrder,
  getOrdersForUser,
  getOrderByIdForUser,
  getOrderPaymentStatusForUser,
  cancelOrderForUser,
};
