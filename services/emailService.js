// services/emailService.js
const axios = require("axios");

let cachedAccessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiry) {
    return cachedAccessToken;
  }

  const res = await axios.post(
    "https://accounts.zoho.com/oauth/v2/token",
    null,
    {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: "refresh_token",
      },
    },
  );

  cachedAccessToken = res.data.access_token;
  tokenExpiry = Date.now() + res.data.expires_in * 1000 - 60_000;

  return cachedAccessToken;
}

function normalize(v) {
  if (!v) return [];
  return Array.isArray(v)
    ? v
    : String(v)
        .split(",")
        .map((s) => s.trim());
}

async function sendOne(msg) {
  const token = await getAccessToken();

  const payload = {
    fromAddress: process.env.ZOHO_MAIL_FROM,
    toAddress: normalize(msg.to).join(","),
    ccAddress: normalize(msg.cc).join(","),
    bccAddress: normalize(msg.bcc).join(","),
    subject: msg.subject,
    content: msg.html || msg.text,
    askReceipt: "no",
  };

  const res = await axios.post(
    `https://mail.zoho.com/api/accounts/${process.env.ZOHO_MAIL_ACCOUNT_ID}/messages`,
    payload,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
      },
      timeout: 15000,
    },
  );

  return res.data;
}

async function sendEmail(input) {
  if (!Array.isArray(input)) {
    await sendOne(input);
    return { mode: "single", sent: 1, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const results = [];

  for (const msg of input) {
    try {
      await sendOne(msg);
      sent++;
      results.push({ ok: true });
    } catch (e) {
      failed++;
      results.push({ ok: false, error: e.message });
    }
  }

  return { mode: "bulk", sent, failed, results };
}

module.exports = { sendEmail };
