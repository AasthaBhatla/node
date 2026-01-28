// services/fcm.js
const { admin, initFirebaseAdmin } = require("./firebaseAdmin");

// init once (safe even if called multiple times)
initFirebaseAdmin();

function maskToken(t) {
  if (!t) return "";
  return t.slice(0, 12) + "..." + t.slice(-8);
}

function toStringMap(obj) {
  // FCM "data" must be string:string
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = String(v);
  return out;
}

async function sendToTokens(tokens = [], payload = {}) {
  const clean = [...new Set(tokens)].filter(Boolean);

  if (!clean.length) return { successCount: 0, failureCount: 0, responses: [] };

  const message = {
    tokens: clean,
    notification: payload.notification,
    data: payload.data ? toStringMap(payload.data) : undefined,
    android: payload.android,
    apns: payload.apns,
    webpush: payload.webpush,
  };

  try {
    const resp = await admin.messaging().sendEachForMulticast(message);

    // Per-token failure logging (super useful)
    if (resp.failureCount > 0) {
      const failures = resp.responses
        .map((r, i) => ({
          token: maskToken(clean[i]),
          ok: r.success,
          code: r.error?.code,
          message: r.error?.message,
        }))
        .filter((x) => !x.ok);

      console.error("❌ FCM multicast failures:", {
        failureCount: resp.failureCount,
        failures: failures.slice(0, 50),
      });
    } else {
      console.log("✅ FCM multicast success:", {
        successCount: resp.successCount,
      });
    }

    return resp;
  } catch (err) {
    console.error("🔥 FCM sendToTokens fatal:", {
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
    });
    throw err;
  }
}

async function sendToTopic(topic, payload = {}) {
  if (!topic) throw new Error("sendToTopic() requires topic");

  const message = {
    topic,
    notification: payload.notification,
    data: payload.data ? toStringMap(payload.data) : undefined,
    android: payload.android,
    apns: payload.apns,
    webpush: payload.webpush,
  };

  try {
    const resp = await admin.messaging().send(message);
    console.log("✅ FCM topic send success:", { topic, messageId: resp });
    return resp;
  } catch (err) {
    console.error("🔥 FCM sendToTopic fatal:", {
      topic,
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
    });
    throw err;
  }
}

module.exports = { sendToTokens, sendToTopic };
