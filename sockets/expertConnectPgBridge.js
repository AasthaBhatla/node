// sockets/expertConnectPgBridge.js
const pool = require("../db");
const socketHub = require("./socketHub");
const {
  EXPERT_CONNECT_EVENTS_CHANNEL,
} = require("../services/expertConnectEvents");

let started = false;

async function startExpertConnectPgBridge() {
  if (started) return;
  started = true;

  const client = await pool.connect();

  try {
    await client.query(`LISTEN ${EXPERT_CONNECT_EVENTS_CHANNEL}`);

    client.on("notification", (msg) => {
      if (!msg?.payload) return;

      try {
        const data = JSON.parse(msg.payload);

        // Event routing
        if (data?.type === "offer_created" && data?.expert_id) {
          socketHub.emitToUser(
            data.expert_id,
            "expert_connect:offer_created",
            data,
          );
          return;
        }
        if (data?.type === "offer_accepted" && data?.client_id) {
          socketHub.emitToUser(
            data.client_id,
            "expert_connect:offer_accepted",
            data,
          );
          return;
        }

        // You can add more bridge events later if you want.
      } catch (e) {
        console.error("expertConnectPgBridge parse error:", e?.message || e);
      }
    });

    client.on("error", (e) => {
      console.error("expertConnectPgBridge pg client error:", e?.message || e);
    });

    console.log(
      "[expert-connect-pg-bridge] listening channel:",
      EXPERT_CONNECT_EVENTS_CHANNEL,
    );
  } catch (e) {
    console.error("[expert-connect-pg-bridge] failed:", e?.message || e);
    try {
      client.release();
    } catch {}
    started = false;
    throw e;
  }
}

module.exports = { startExpertConnectPgBridge };
