// services/razorpayWebhookService.js
const crypto = require("crypto");
const pool = require("../db");

function verifyWebhookSignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // timing-safe compare
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature || ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

exports.handleRazorpayWebhook = async ({ rawBody, signature }) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    const e = new Error("RAZORPAY_WEBHOOK_SECRET is not set on server");
    e.statusCode = 500;
    throw e;
  }

  if (!signature) {
    const e = new Error("Missing X-Razorpay-Signature header");
    e.statusCode = 400;
    throw e;
  }

  // Verify signature using raw body
  const ok = verifyWebhookSignature(rawBody, signature, secret);
  if (!ok) {
    const e = new Error("Invalid webhook signature");
    e.statusCode = 400;
    throw e;
  }

  // Parse JSON AFTER signature verification
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (parseErr) {
    // Don’t cause retries for bad payload formatting
    return;
  }

  const eventName = event?.event;
  if (!eventName) return;

  const allowed = new Set(["payment.captured", "order.paid"]);
  if (!allowed.has(eventName)) return;

  let razorpay_order_id = null;
  let razorpay_payment_id = null;

  // For amount verification (only reliably present on payment.captured)
  let payment_amount = null;
  let payment_currency = null;

  if (eventName === "payment.captured") {
    const payment = event?.payload?.payment?.entity;
    razorpay_order_id = payment?.order_id || null;
    razorpay_payment_id = payment?.id || null;
    payment_amount = payment?.amount ?? null; // paise
    payment_currency = payment?.currency ?? null;
  } else if (eventName === "order.paid") {
    const order = event?.payload?.order?.entity;
    razorpay_order_id = order?.id || null;
  }

  if (!razorpay_order_id) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock internal order row by razorpay_order_id
    const orderRes = await client.query(
      `SELECT *
       FROM orders
       WHERE razorpay_order_id = $1
       FOR UPDATE`,
      [razorpay_order_id],
    );

    const order = orderRes.rows[0];
    if (!order) {
      await client.query("COMMIT");
      return;
    }

    // ✅ Amount verification (only when we have payment info)
    if (eventName === "payment.captured") {
      const expectedAmount = parseInt(order.total_amount_paise || 0, 10);

      // If payment payload doesn't include amount/currency, skip check
      if (payment_amount != null && payment_currency != null) {
        if (String(payment_currency).toUpperCase() !== "INR") {
          // suspicious or misconfigured
          await client.query("COMMIT");
          return;
        }
        if (parseInt(payment_amount, 10) !== expectedAmount) {
          // Amount mismatch -> do not credit
          await client.query("COMMIT");
          return;
        }
      }
    }

    // Mark order paid/completed (idempotent)
    const updatedRes = await client.query(
      `UPDATE orders
       SET status = 'completed',
           paid_at = COALESCE(paid_at, NOW()),
           razorpay_payment_id = COALESCE(razorpay_payment_id, $2)
       WHERE order_id = $1
       RETURNING *`,
      [order.order_id, razorpay_payment_id],
    );

    let updatedOrder = updatedRes.rows[0];

    // Grant credits once
    const credits = parseInt(updatedOrder.credits_to_grant || 0, 10);

    if (!updatedOrder.credits_granted && credits > 0) {
      const idempotency_key = `razorpay:${razorpay_order_id}:credit`;

      // Ensure wallet row exists
      await client.query(
        `INSERT INTO wallet (user_id, balance_credits)
         VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [updatedOrder.user_id],
      );

      // Lock wallet row
      const wRes = await client.query(
        `SELECT user_id, balance_credits
         FROM wallet
         WHERE user_id = $1
         FOR UPDATE`,
        [updatedOrder.user_id],
      );

      if (!wRes.rows[0]) {
        const e = new Error("Wallet not found");
        e.statusCode = 404;
        throw e;
      }

      // Insert credit ledger (idempotent)
      const ins = await client.query(
        `INSERT INTO wallet_transactions
          (user_id, direction, amount_credits, reason, reference_kind, reference_id, idempotency_key, metadata)
         VALUES
          ($1, 'credit', $2, 'topup', 'order', $3, $4, COALESCE($5, '{}'::jsonb))
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          updatedOrder.user_id,
          credits,
          String(updatedOrder.order_id),
          idempotency_key,
          JSON.stringify({
            razorpay_order_id,
            razorpay_payment_id: razorpay_payment_id || null,
            event: eventName,
          }),
        ],
      );

      if (ins.rowCount === 1) {
        await client.query(
          `UPDATE wallet
           SET balance_credits = balance_credits + $1,
               updated_at = NOW()
           WHERE user_id = $2`,
          [credits, updatedOrder.user_id],
        );
      }

      await client.query(
        `UPDATE orders
         SET credits_granted = TRUE
         WHERE order_id = $1`,
        [updatedOrder.order_id],
      );
    }

    await client.query("COMMIT");
    return;
  } catch (err) {
    await client.query("ROLLBACK");
    err.statusCode = err.statusCode || 500;
    throw err;
  } finally {
    client.release();
  }
};
