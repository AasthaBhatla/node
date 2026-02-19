// workers/expertConnectWorker.js
require("dotenv").config();
const pool = require("../db");
const {
  dispatchOffersBatch,
  expireOffersBatch,
  DISPATCH_CHANNEL,
} = require("../services/expertConnectDispatcher");

const INTERVAL_MS = Number(
  process.env.EXPERT_CONNECT_DISPATCH_INTERVAL_MS || 2000,
);
const DISPATCH_BATCH = Number(process.env.EXPERT_CONNECT_DISPATCH_BATCH || 10);
const EXPIRE_BATCH = Number(process.env.EXPERT_CONNECT_EXPIRE_BATCH || 50);

let running = false;

async function runCycle(trigger = "interval") {
  if (running) return;
  running = true;

  try {
    // 1) expire old offers silently
    await expireOffersBatch(EXPIRE_BATCH);

    // 2) offer queued requests
    await dispatchOffersBatch(DISPATCH_BATCH);
  } catch (e) {
    console.error(
      `[expert-connect-worker] cycle error (${trigger}):`,
      e?.message || e,
    );
  } finally {
    running = false;
  }
}

(async function main() {
  console.log("[expert-connect-worker] starting...");
  console.log("[expert-connect-worker] listen channel:", DISPATCH_CHANNEL);
  console.log("[expert-connect-worker] interval(ms):", INTERVAL_MS);

  // Dedicated listen connection from pool
  const listenClient = await pool.connect();

  try {
    await listenClient.query(`LISTEN ${DISPATCH_CHANNEL}`);
    listenClient.on("notification", () => {
      runCycle("notify").catch(() => {});
    });

    // startup run
    await runCycle("startup");

    // fallback polling
    setInterval(() => {
      runCycle("interval").catch(() => {});
    }, INTERVAL_MS);
  } catch (e) {
    console.error("[expert-connect-worker] fatal:", e?.message || e);
    process.exit(1);
  }
})();
