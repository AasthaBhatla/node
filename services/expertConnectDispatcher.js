// services/expertConnectDispatcher.js
const pool = require("../db");
const notify = require("./notify");

const OFFER_TTL_SECONDS = Number(
  process.env.EXPERT_CONNECT_OFFER_TTL_SECONDS || 30,
);

const DISPATCH_CHANNEL = "expert_connect_kick";

// Batches (defaults are safe)
const DISPATCH_BATCH = Number(process.env.EXPERT_CONNECT_DISPATCH_BATCH || 10);
const EXPIRE_BATCH = Number(process.env.EXPERT_CONNECT_EXPIRE_BATCH || 50);

// New: reconcile ended sessions in batches (falls back to EXPIRE_BATCH if not set)
const RECONCILE_BATCH = Number(
  process.env.EXPERT_CONNECT_RECONCILE_BATCH || EXPIRE_BATCH || 50,
);

function normalizeRoleSql() {
  // keep consistent role checks (trim avoids whitespace issues)
  return `LOWER(TRIM(COALESCE(u.role, ''))) = 'expert'`;
}

async function ensureExpertsInAvailability(client) {
  await client.query(
    `
      INSERT INTO expert_availability (
        expert_id,
        is_online,
        max_concurrent_clients,
        current_active_clients,
        created_at,
        updated_at
      )
      SELECT u.id, TRUE, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM users u
      WHERE ${normalizeRoleSql()}
      ON CONFLICT (expert_id) DO NOTHING
    `,
  );
}

async function normalizeQueuePositions(client) {
  await client.query(`
    WITH ordered AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY created_at, id) AS new_position
      FROM expert_connection_queue
      WHERE status = 'queued'
    )
    UPDATE expert_connection_queue q
    SET
      position = o.new_position,
      updated_at = CURRENT_TIMESTAMP
    FROM ordered o
    WHERE q.id = o.id
      AND q.position IS DISTINCT FROM o.new_position
  `);
}

/**
 * Wake dispatcher worker quickly using Postgres NOTIFY.
 * Safe to call even if worker isn't running.
 */
async function kickDispatcher() {
  try {
    await pool.query(`NOTIFY ${DISPATCH_CHANNEL}, '1'`);
  } catch (e) {
    console.error("expertConnect kickDispatcher failed:", e?.message || e);
  }
}

/**
 * Expire old offers and requeue them (silent).
 * Safe with multiple workers due to SKIP LOCKED.
 */
async function expireOffersBatch(limit = 50) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const expired = await client.query(
      `
      WITH target AS (
        SELECT id
        FROM expert_connection_queue
        WHERE status = 'offered'
          AND offer_expires_at IS NOT NULL
          AND offer_expires_at < NOW()
        ORDER BY offer_expires_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE expert_connection_queue q
      SET
        status = 'queued',
        expert_id = NULL,
        offered_at = NULL,
        offer_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      FROM target t
      WHERE q.id = t.id
      RETURNING q.id
      `,
      [limit],
    );

    if (expired.rowCount > 0) {
      await normalizeQueuePositions(client);
    }

    await client.query("COMMIT");
    return { expired_count: expired.rowCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ✅ Reconcile ended WALLET sessions:
 * If a wallet session is ended, but expert_connection_queue is still assigned/connected,
 * mark it completed AND decrement expert load.
 *
 * ASSUMPTION:
 *   expert_connection_queue has a nullable column:
 *     session_id BIGINT REFERENCES sessions(session_id)
 *
 * No changes to sessions/wallet required.
 */
async function reconcileEndedWalletSessions(limit = 50) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure availability rows exist (so decrement won't "miss" because row absent)
    await ensureExpertsInAvailability(client);

    // 1) Find active expert-connect rows whose linked wallet session has ended
    // 2) Mark them completed (once) using SKIP LOCKED
    const completed = await client.query(
      `
      WITH target AS (
        SELECT
          q.id,
          q.expert_id,
          COALESCE(s.ended_at, NOW()) AS ended_at
        FROM expert_connection_queue q
        JOIN sessions s ON s.session_id = q.session_id
        WHERE q.status IN ('assigned', 'connected')
          AND q.session_id IS NOT NULL
          AND s.status = 'ended'
        ORDER BY COALESCE(s.ended_at, NOW()) ASC, q.id ASC
        FOR UPDATE OF q SKIP LOCKED
        LIMIT $1
      ),
      updated AS (
        UPDATE expert_connection_queue q
        SET
          status = 'completed',
          completed_at = t.ended_at,
          -- cleanup any stale offer timers
          offered_at = NULL,
          offer_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        FROM target t
        WHERE q.id = t.id
        RETURNING q.id, q.expert_id
      )
      SELECT * FROM updated
      `,
      [limit],
    );

    const rows = completed.rows || [];
    if (rows.length) {
      // Decrement load per expert by count of reconciled requests
      await client.query(
        `
        WITH dec AS (
          SELECT expert_id, COUNT(*)::INT AS cnt
          FROM (SELECT expert_id FROM (VALUES ${rows
            .map((_, i) => `($${i + 1}::int)`)
            .join(", ")}) v(expert_id)) x
          WHERE expert_id IS NOT NULL
          GROUP BY expert_id
        )
        UPDATE expert_availability ea
        SET
          current_active_clients = GREATEST(ea.current_active_clients - dec.cnt, 0),
          updated_at = CURRENT_TIMESTAMP
        FROM dec
        WHERE ea.expert_id = dec.expert_id
        `,
        rows
          .map((r) => (r.expert_id ? Number(r.expert_id) : null))
          .filter((x) => Number.isInteger(x) && x > 0),
      );
    }

    await client.query("COMMIT");

    return { reconciled_count: rows.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pick ONE queued request and ONE available expert and convert to offered.
 * Returns null when nothing can be offered right now.
 */
async function dispatchOneOffer() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureExpertsInAvailability(client);

    // 1) lock the next queued request
    const qReq = await client.query(`
      SELECT *
      FROM expert_connection_queue
      WHERE status = 'queued'
      ORDER BY created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    const reqRow = qReq.rows[0];
    if (!reqRow) {
      await client.query("COMMIT");
      return null;
    }

    // 2) lock an available expert (capacity-aware, and counts pending offers)
    const qExpert = await client.query(`
      SELECT
        ea.expert_id,
        ea.current_active_clients,
        ea.max_concurrent_clients,
        COALESCE(p.offered_pending, 0)::INT AS offered_pending
      FROM expert_availability ea
      JOIN users u ON u.id = ea.expert_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS offered_pending
        FROM expert_connection_queue q
        WHERE q.expert_id = ea.expert_id
          AND q.status = 'offered'
          AND (q.offer_expires_at IS NULL OR q.offer_expires_at > NOW())
      ) p ON TRUE
      WHERE ${normalizeRoleSql()}
        AND ea.is_online = TRUE
        AND (ea.current_active_clients + COALESCE(p.offered_pending, 0)) < ea.max_concurrent_clients
      ORDER BY ea.last_assigned_at ASC NULLS FIRST, ea.expert_id ASC
      FOR UPDATE OF ea SKIP LOCKED
      LIMIT 1
    `);

    const expertRow = qExpert.rows[0];
    if (!expertRow) {
      // no expert available right now, keep request queued
      await normalizeQueuePositions(client);
      await client.query("COMMIT");
      return { offered: false, reason: "no_expert_available" };
    }

    // 3) offer the request to that expert
    const updated = await client.query(
      `
      UPDATE expert_connection_queue
      SET
        status = 'offered',
        expert_id = $2,
        position = NULL,
        estimated_wait_seconds = 0,
        offered_at = CURRENT_TIMESTAMP,
        offer_expires_at = CURRENT_TIMESTAMP + ($3 || ' seconds')::INTERVAL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [reqRow.id, expertRow.expert_id, String(OFFER_TTL_SECONDS)],
    );

    // maintain queue positions for remaining queued requests
    await normalizeQueuePositions(client);

    // update last_assigned_at for fairness rotation (offer counts as "assignment attempt")
    await client.query(
      `
      UPDATE expert_availability
      SET
        last_assigned_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE expert_id = $1
      `,
      [expertRow.expert_id],
    );

    await client.query("COMMIT");

    const offeredRow = updated.rows[0];

    // 4) notify expert AFTER commit (push only)
    try {
      const expertId = Number(expertRow?.expert_id);
      if (!Number.isInteger(expertId) || expertId < 1) {
        console.error(
          "Offer created but invalid expert_id for notify:",
          expertRow?.expert_id,
        );
      } else {
        await notify.user(
          Number(expertRow.expert_id),
          {
            title: "New client request",
            body: "You have a new request. Tap to accept.",
            data: {
              type: "expert_connect_offer_created",
              expert_connect_request_id: Number(offeredRow.id),
              client_user_id: Number(offeredRow.client_id),
              expert_user_id: Number(expertRow.expert_id),
            },
            push: true,
            store: false,
            email: false,
          },
          "expert_connect.offer.created",
        );
      }
    } catch (e) {
      console.error("notify expert offer failed:", e?.message || e);
    }

    return {
      offered: true,
      request_id: offeredRow.id,
      expert_id: expertRow.expert_id,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Offer up to N requests in one cycle.
 */
async function dispatchOffersBatch(maxOffers = 10) {
  let offeredCount = 0;

  for (let i = 0; i < maxOffers; i += 1) {
    const r = await dispatchOneOffer();
    if (!r) break; // no queued requests
    if (r.offered) {
      offeredCount += 1;
      continue;
    }
    // has queued requests but no experts
    break;
  }

  return { offered_count: offeredCount };
}

/**
 * ✅ Run ONE full cycle (call this from your worker tick / kick handler)
 * Order matters:
 *  1) expire offers
 *  2) reconcile ended wallet sessions (frees capacity)
 *  3) dispatch new offers
 */
async function runDispatcherCycle({
  expireLimit = EXPIRE_BATCH,
  reconcileLimit = RECONCILE_BATCH,
  maxOffers = DISPATCH_BATCH,
} = {}) {
  const expired = await expireOffersBatch(expireLimit);
  const reconciled = await reconcileEndedWalletSessions(reconcileLimit);
  const offered = await dispatchOffersBatch(maxOffers);

  return {
    expired,
    reconciled,
    offered,
  };
}

module.exports = {
  kickDispatcher,
  expireOffersBatch,
  reconcileEndedWalletSessions,
  dispatchOffersBatch,
  runDispatcherCycle,
  DISPATCH_CHANNEL,
};
