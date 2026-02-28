// services/expertConnectEvents.js
const pool = require("../db");

const EXPERT_CONNECT_EVENTS_CHANNEL =
  process.env.EXPERT_CONNECT_EVENTS_CHANNEL || "expert_connect_events";

async function publishExpertConnectEvent(payload) {
  try {
    const msg = JSON.stringify(payload || {});
    // NOTIFY with params safely:
    await pool.query("SELECT pg_notify($1, $2)", [
      EXPERT_CONNECT_EVENTS_CHANNEL,
      msg,
    ]);
  } catch (e) {
    console.error(
      "publishExpertConnectEvent failed:",
      e?.message || e,
      payload,
    );
  }
}

module.exports = {
  EXPERT_CONNECT_EVENTS_CHANNEL,
  publishExpertConnectEvent,
};
