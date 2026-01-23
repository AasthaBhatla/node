const { handleRazorpayWebhook } = require("../services/razorpayWebhookService");

exports.razorpay = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];

  try {
    await handleRazorpayWebhook({
      rawBody: req.body, // Buffer
      signature,
    });

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Razorpay webhook error:", err);

    // Only signature problems should return non-2xx
    const msg = String(err?.message || "");
    const isSignatureError =
      err?.statusCode === 400 &&
      (msg.toLowerCase().includes("signature") ||
        msg.toLowerCase().includes("x-razorpay-signature"));

    if (isSignatureError) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    // For everything else, ACK 200 to avoid retries
    return res.status(200).json({ status: "ok" });
  }
};
