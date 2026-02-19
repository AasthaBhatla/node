require("dotenv").config();
const pool = require("../db");
const {
  runDispatcherCycle,
  DISPATCH_CHANNEL,
} = require("../services/expertConnectDispatcher");

const INTERVAL_MS = Number(
  process.env.EXPERT_CONNECT_DISPATCH_INTERVAL_MS || 2000,
);

let running = false;

async function runCycle(trigger = "interval") {
  if (running) return;
  running = true;

  try {
    const out = await runDispatcherCycle();

    // Helpful log so you can see what's happening:
    console.log(
      `[expert-connect-worker] cycle (${trigger})`,
      JSON.stringify(out),
    );
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

  const listenClient = await pool.connect();

  try {
    await listenClient.query(`LISTEN ${DISPATCH_CHANNEL}`);

    listenClient.on("notification", () => {
      runCycle("notify").catch(() => {});
    });

    await runCycle("startup");

    setInterval(() => {
      runCycle("interval").catch(() => {});
    }, INTERVAL_MS);
  } catch (e) {
    console.error("[expert-connect-worker] fatal:", e?.message || e);
    process.exit(1);
  }
})();
