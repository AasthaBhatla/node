// services/expertConnectService.js
const pool = require("../db");
const notify = require("./notify");
const { kickDispatcher } = require("./expertConnectDispatcher");

const AVG_SESSION_SECONDS = 10 * 60;

// If you already have env vars for TTL, do this:
const OFFER_TTL_SECONDS = Number(
  process.env.EXPERT_CONNECT_OFFER_TTL_SECONDS || 30,
);

const STATUS = Object.freeze({
  QUEUED: "queued",
  OFFERED: "offered",
  ASSIGNED: "assigned",
  CONNECTED: "connected",
  CANCELLED: "cancelled",
  TIMED_OUT: "timed_out",
  COMPLETED: "completed",
});

const STATUS_GROUPS = Object.freeze({
  ACTIVE_CLIENT: Object.freeze([
    STATUS.QUEUED,
    STATUS.OFFERED,
    STATUS.ASSIGNED,
    STATUS.CONNECTED,
  ]),
  ACTIVE_EXPERT: Object.freeze([
    STATUS.OFFERED,
    STATUS.ASSIGNED,
    STATUS.CONNECTED,
  ]),
  TERMINAL: Object.freeze([
    STATUS.CANCELLED,
    STATUS.TIMED_OUT,
    STATUS.COMPLETED,
  ]),
});

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .trim();
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
      WHERE LOWER(COALESCE(u.role, '')) = 'expert'
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

async function getQueuePosition(client, requestId) {
  const result = await client.query(
    `
      SELECT COUNT(*)::INT AS position
      FROM expert_connection_queue q
      JOIN expert_connection_queue current_q ON current_q.id = $1
      WHERE q.status = 'queued'
        AND (q.created_at, q.id) <= (current_q.created_at, current_q.id)
    `,
    [requestId],
  );

  return Number(result.rows[0]?.position || 0) || null;
}

async function estimateWaitSeconds(client, queuePosition) {
  if (!queuePosition || queuePosition < 1) return 0;

  const cap = await client.query(
    `
      SELECT
        COALESCE(SUM(ea.max_concurrent_clients), 0)::INT AS total_capacity
      FROM expert_availability ea
      JOIN users u ON u.id = ea.expert_id
      WHERE LOWER(COALESCE(u.role, '')) = 'expert'
        AND ea.is_online = TRUE
    `,
  );

  const totalCapacity = Number(cap.rows[0]?.total_capacity || 0);
  if (totalCapacity <= 0) return null;

  const waves = Math.ceil(queuePosition / totalCapacity);
  return waves * AVG_SESSION_SECONDS;
}

async function pickAvailableExpertForUpdate(client) {
  const result = await client.query(
    `
      SELECT
        ea.expert_id,
        ea.current_active_clients,
        ea.max_concurrent_clients
      FROM expert_availability ea
      JOIN users u ON u.id = ea.expert_id
      WHERE LOWER(COALESCE(u.role, '')) = 'expert'
        AND ea.is_online = TRUE
        AND ea.current_active_clients < ea.max_concurrent_clients
      ORDER BY ea.last_assigned_at ASC NULLS FIRST, ea.expert_id ASC
      FOR UPDATE OF ea SKIP LOCKED
      LIMIT 1
    `,
  );

  return result.rows[0] || null;
}

async function getUserRole(client, userId) {
  const result = await client.query(`SELECT role FROM users WHERE id = $1`, [
    userId,
  ]);
  return result.rows[0]?.role || null;
}

async function getExpertSummary(expertId, db = pool) {
  if (!expertId) return null;

  const result = await db.query(
    `
      SELECT
        u.id,
        u.email,
        u.phone,
        u.role,
        COALESCE(
          (
            SELECT value
            FROM user_metadata
            WHERE user_id = u.id AND key = 'first_name'
            LIMIT 1
          ),
          (
            SELECT value
            FROM user_metadata
            WHERE user_id = u.id AND key = 'name'
            LIMIT 1
          ),
          (
            SELECT value
            FROM user_metadata
            WHERE user_id = u.id AND key = 'display_name'
            LIMIT 1
          )
        ) AS name
      FROM users u
      WHERE u.id = $1
      LIMIT 1
    `,
    [expertId],
  );

  return result.rows[0] || null;
}

async function getClientSummary(clientId, db = pool) {
  if (!clientId) return null;

  const result = await db.query(
    `
      SELECT
        u.id,
        u.email,
        u.phone,
        u.role,
        COALESCE(
          (SELECT value FROM user_metadata WHERE user_id = u.id AND key = 'first_name' LIMIT 1),
          (SELECT value FROM user_metadata WHERE user_id = u.id AND key = 'name' LIMIT 1),
          (SELECT value FROM user_metadata WHERE user_id = u.id AND key = 'display_name' LIMIT 1)
        ) AS name
      FROM users u
      WHERE u.id = $1
      LIMIT 1
    `,
    [clientId],
  );

  return result.rows[0] || null;
}

async function getActiveRequestForClient(client, clientId) {
  const result = await client.query(
    `
      SELECT *
      FROM expert_connection_queue
      WHERE client_id = $1
        AND status = ANY($2::expert_connection_status[])
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [clientId, STATUS_GROUPS.ACTIVE_CLIENT],
  );

  return result.rows[0] || null;
}

async function serializeRequest(client, row) {
  if (!row) return null;

  let position = row.position;
  let estimatedWait = row.estimated_wait_seconds;

  if (row.status === "queued") {
    position = await getQueuePosition(client, row.id);
    estimatedWait = await estimateWaitSeconds(client, position);
  } else {
    position = null;
    estimatedWait = 0;
  }

  const expert = row.expert_id
    ? await getExpertSummary(row.expert_id, client)
    : null;
  const clientUser = row.client_id
    ? await getClientSummary(row.client_id, client)
    : null;

  return {
    ...row,
    position,
    estimated_wait_seconds: estimatedWait,
    expert,
    client: clientUser,

    // frontend hint: when should we allow LiveKit UI to show?
    can_start_connect_flow: [STATUS.ASSIGNED, STATUS.CONNECTED].includes(
      row.status,
    ),
  };
}

async function decrementExpertLoad(client, expertId) {
  const r = await client.query(
    `
      UPDATE expert_availability
      SET
        current_active_clients = GREATEST(current_active_clients - 1, 0),
        updated_at = CURRENT_TIMESTAMP
      WHERE expert_id = $1
      RETURNING current_active_clients
    `,
    [expertId],
  );

  if (r.rowCount === 0) {
    console.warn(
      "decrementExpertLoad: no expert_availability row for expert_id",
      expertId,
    );
  }
}

async function assignQueuedClientsToExpertTx(client, expertId) {
  const lock = await client.query(
    `
      SELECT
        expert_id,
        is_online,
        max_concurrent_clients,
        current_active_clients
      FROM expert_availability
      WHERE expert_id = $1
      FOR UPDATE
    `,
    [expertId],
  );

  const availability = lock.rows[0];
  if (!availability || !availability.is_online) return [];

  let freeSlots =
    Number(availability.max_concurrent_clients) -
    Number(availability.current_active_clients);
  if (freeSlots <= 0) return [];

  const assignedRows = [];

  while (freeSlots > 0) {
    const queued = await client.query(
      `
        SELECT *
        FROM expert_connection_queue
        WHERE status = 'queued'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
    );

    const queuedRow = queued.rows[0];
    if (!queuedRow) break;

    const updated = await client.query(
      `
        UPDATE expert_connection_queue
        SET
          status = 'assigned',
          expert_id = $2,
          position = NULL,
          estimated_wait_seconds = 0,
          assigned_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [queuedRow.id, expertId],
    );

    await client.query(
      `
        UPDATE expert_availability
        SET
          current_active_clients = current_active_clients + 1,
          last_assigned_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE expert_id = $1
      `,
      [expertId],
    );

    assignedRows.push(updated.rows[0]);
    freeSlots -= 1;
  }

  await normalizeQueuePositions(client);
  return assignedRows;
}

function assertRequestAccess(row, actorId, actorRole) {
  const role = normalizeRole(actorRole);
  const numericActorId = Number(actorId);

  if (role === "admin") return;
  if (role === "client" && Number(row.client_id) === numericActorId) return;
  if (role === "expert" && Number(row.expert_id) === numericActorId) return;

  throw httpError("Access denied", 403);
}

async function requestConnection(clientId) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const role = normalizeRole(await getUserRole(dbClient, clientId));
    if (role !== "client") {
      throw httpError("Only clients can request expert connection", 403);
    }

    // Active request check (should include: queued/offered/assigned/connected)
    const existing = await getActiveRequestForClient(dbClient, clientId);
    if (existing) {
      const existingPayload = await serializeRequest(dbClient, existing);
      await dbClient.query("COMMIT");

      // If it's queued, kick dispatcher so it tries to offer quickly
      if (existing.status === STATUS.QUEUED) {
        kickDispatcher().catch(() => {});
      }

      return {
        is_existing: true,
        status: existing.status,
        request: existingPayload,
      };
    }

    // ✅ Always insert queued (dispatcher will offer to an expert)
    const queued = await dbClient.query(
      `
        INSERT INTO expert_connection_queue (
          client_id,
          status,
          position,
          created_at,
          updated_at
        )
        VALUES ($1, 'queued', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *
      `,
      [clientId],
    );

    await normalizeQueuePositions(dbClient);

    const queueRow = queued.rows[0];
    const position = await getQueuePosition(dbClient, queueRow.id);
    const estimatedWaitSeconds = await estimateWaitSeconds(dbClient, position);

    const updatedQueued = await dbClient.query(
      `
        UPDATE expert_connection_queue
        SET
          position = $2,
          estimated_wait_seconds = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [queueRow.id, position, estimatedWaitSeconds],
    );

    const payload = await serializeRequest(dbClient, updatedQueued.rows[0]);

    await dbClient.query("COMMIT");

    // 🔥 Wake dispatcher worker to offer immediately (no notification here)
    kickDispatcher().catch(() => {});

    return {
      is_existing: false,
      status: "queued",
      request: payload,
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");

    // If concurrent request happened (unique active index hit), return existing active request
    if (err.code === "23505") {
      const existing = await pool.query(
        `
          SELECT *
          FROM expert_connection_queue
          WHERE client_id = $1
            AND status = ANY($2::expert_connection_status[])
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
        [clientId, STATUS_GROUPS.ACTIVE_CLIENT],
      );

      if (existing.rows[0]) {
        const requestPayload = await serializeRequest(pool, existing.rows[0]);

        // Kick dispatcher in case it's queued
        if (existing.rows[0].status === "queued") {
          kickDispatcher().catch(() => {});
        }

        return {
          is_existing: true,
          status: existing.rows[0].status,
          request: requestPayload,
        };
      }
    }

    throw err;
  } finally {
    dbClient.release();
  }
}

async function getRequestStatus({ requestId, actorId, actorRole }) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const result = await dbClient.query(
      `SELECT * FROM expert_connection_queue WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) throw httpError("Connection request not found", 404);

    assertRequestAccess(row, actorId, actorRole);

    let requestRow = row;
    if (row.status === "queued") {
      await normalizeQueuePositions(dbClient);
      const position = await getQueuePosition(dbClient, row.id);
      const estimatedWaitSeconds = await estimateWaitSeconds(
        dbClient,
        position,
      );

      const updated = await dbClient.query(
        `
          UPDATE expert_connection_queue
          SET
            position = $2,
            estimated_wait_seconds = $3,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `,
        [row.id, position, estimatedWaitSeconds],
      );
      requestRow = updated.rows[0];
    }

    const payload = await serializeRequest(dbClient, requestRow);
    await dbClient.query("COMMIT");
    return payload;
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function cancelRequest({ requestId, actorId, actorRole }) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const result = await dbClient.query(
      `SELECT * FROM expert_connection_queue WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) throw httpError("Connection request not found", 404);

    const prevStatus = row.status;
    const prevExpertId = row.expert_id ? Number(row.expert_id) : null;
    const prevClientId = Number(row.client_id);

    const role = normalizeRole(actorRole);
    if (role !== "admin" && Number(row.client_id) !== Number(actorId)) {
      throw httpError("Access denied", 403);
    }

    if (STATUS_GROUPS.TERMINAL.includes(row.status)) {
      const payload = await serializeRequest(dbClient, row);
      await dbClient.query("COMMIT");
      return { request: payload, auto_assigned_requests: [] };
    }

    const wasActiveWithExpert =
      ["assigned", "connected"].includes(row.status) && row.expert_id;

    const updated = await dbClient.query(
      `
        UPDATE expert_connection_queue
        SET
          status = 'cancelled',
          position = NULL,
          cancelled_at = CURRENT_TIMESTAMP,
          -- optional cleanup (keeps history but removes active offer timers)
          offered_at = NULL,
          offer_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [requestId],
    );

    if (wasActiveWithExpert) {
      await decrementExpertLoad(dbClient, row.expert_id);
    }

    await normalizeQueuePositions(dbClient);

    const payload = await serializeRequest(dbClient, updated.rows[0]);
    await dbClient.query("COMMIT");

    // Notify expert if client cancelled while expert was involved (push only)
    try {
      const shouldNotifyExpert =
        role === "client" &&
        prevExpertId &&
        ["offered", "assigned", "connected"].includes(prevStatus);

      if (shouldNotifyExpert) {
        await notify.user(
          prevExpertId,
          {
            title: "Request cancelled",
            body: "The client cancelled the request.",
            data: {
              type: "expert_connect_request_cancelled_by_client",
              expert_connect_request_id: Number(requestId),
              client_user_id: prevClientId,
              expert_user_id: prevExpertId,
            },
            push: true,
            store: false,
            email: false,
          },
          "expert_connect.request.cancelled_by_client",
        );
      }
    } catch (e) {
      console.error("notify expert cancel failed:", e?.message || e);
    }

    kickDispatcher().catch(() => {});

    return { request: payload, auto_assigned_requests: [] };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function setExpertOnlineStatus({
  expertId,
  isOnline,
  maxConcurrentClients,
}) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const user = await dbClient.query(
      `SELECT id, role FROM users WHERE id = $1 LIMIT 1`,
      [expertId],
    );
    const userRow = user.rows[0];

    if (!userRow) throw httpError("Expert not found", 404);
    if (normalizeRole(userRow.role) !== "expert") {
      throw httpError("Selected user is not an expert", 400);
    }

    if (maxConcurrentClients != null) {
      const max = Number(maxConcurrentClients);
      if (!Number.isInteger(max) || max < 1) {
        throw httpError("max_concurrent_clients must be an integer >= 1", 400);
      }
    }

    const existing = await dbClient.query(
      `
        SELECT *
        FROM expert_availability
        WHERE expert_id = $1
        FOR UPDATE
      `,
      [expertId],
    );

    let availabilityRow;

    if (!existing.rows[0]) {
      const max = Number(maxConcurrentClients || 1);
      const inserted = await dbClient.query(
        `
          INSERT INTO expert_availability (
            expert_id,
            is_online,
            max_concurrent_clients,
            current_active_clients,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *
        `,
        [expertId, Boolean(isOnline), max],
      );
      availabilityRow = inserted.rows[0];
    } else {
      const current = existing.rows[0];
      const nextMax =
        maxConcurrentClients != null
          ? Number(maxConcurrentClients)
          : Number(current.max_concurrent_clients);

      if (nextMax < Number(current.current_active_clients)) {
        throw httpError(
          "max_concurrent_clients cannot be lower than current active clients",
          400,
        );
      }

      const updated = await dbClient.query(
        `
          UPDATE expert_availability
          SET
            is_online = $2,
            max_concurrent_clients = $3,
            updated_at = CURRENT_TIMESTAMP
          WHERE expert_id = $1
          RETURNING *
        `,
        [expertId, Boolean(isOnline), nextMax],
      );
      availabilityRow = updated.rows[0];
    }

    await dbClient.query("COMMIT");
    // Kick dispatcher when expert is online (or capacity changes)
    kickDispatcher().catch(() => {});
    return {
      availability: availabilityRow,
      auto_assigned_requests: [],
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function markConnected({ requestId, actorId, actorRole }) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const result = await dbClient.query(
      `SELECT * FROM expert_connection_queue WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) throw httpError("Connection request not found", 404);

    assertRequestAccess(row, actorId, actorRole);

    if (row.status === "connected") {
      const payload = await serializeRequest(dbClient, row);
      await dbClient.query("COMMIT");
      return payload;
    }

    if (row.status !== "assigned") {
      throw httpError("Only assigned requests can be marked connected", 409);
    }

    const updated = await dbClient.query(
      `
        UPDATE expert_connection_queue
        SET
          status = 'connected',
          connected_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [requestId],
    );

    const payload = await serializeRequest(dbClient, updated.rows[0]);
    await dbClient.query("COMMIT");
    return payload;
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function completeRequest({ requestId, actorId, actorRole }) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const result = await dbClient.query(
      `SELECT * FROM expert_connection_queue WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) throw httpError("Connection request not found", 404);

    assertRequestAccess(row, actorId, actorRole);

    if (STATUS_GROUPS.TERMINAL.includes(row.status)) {
      const payload = await serializeRequest(dbClient, row);
      await dbClient.query("COMMIT");
      return { request: payload, auto_assigned_requests: [] };
    }

    if (!["assigned", "connected"].includes(row.status)) {
      throw httpError("Only assigned/connected requests can be completed", 409);
    }

    const updated = await dbClient.query(
      `
        UPDATE expert_connection_queue
        SET
          status = 'completed',
          position = NULL,
          completed_at = CURRENT_TIMESTAMP,
          -- optional cleanup
          offered_at = NULL,
          offer_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [requestId],
    );

    // Decrement only if the expert had actually been "active" (assigned/connected)
    if (row.expert_id) {
      await decrementExpertLoad(dbClient, row.expert_id);
    }

    const payload = await serializeRequest(dbClient, updated.rows[0]);
    await dbClient.query("COMMIT");

    // Notify client (push + store + email) + rating prompt
    try {
      await notify.user(
        Number(updated.rows[0].client_id),
        {
          title: "Session completed",
          body: "How was your conversation? Tap to rate it.",
          data: {
            type: "expert_connect_session_completed",
            expert_connect_request_id: Number(updated.rows[0].id),
            client_user_id: Number(updated.rows[0].client_id),
            expert_user_id: updated.rows[0].expert_id
              ? Number(updated.rows[0].expert_id)
              : null,
            ask_for_rating: true,
          },
          push: true,
          store: true,
          email: true,
        },
        "expert_connect.session.completed",
      );
    } catch (e) {
      console.error("notify client completed failed:", e?.message || e);
    }

    // Let dispatcher offer next queued request if capacity is free
    kickDispatcher().catch(() => {});

    return { request: payload, auto_assigned_requests: [] };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function getQueueOverview() {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");
    await ensureExpertsInAvailability(dbClient);

    // 1) Summary counts + rejection stats (request-level)
    const summary = await dbClient.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::INT     AS queued_requests,
        COUNT(*) FILTER (WHERE status = 'offered')::INT    AS offered_requests,
        COUNT(*) FILTER (WHERE status = 'assigned')::INT   AS assigned_requests,
        COUNT(*) FILTER (WHERE status = 'connected')::INT  AS connected_requests,

        -- Rejection stats (request-level; you store only the latest rejected_at)
        COUNT(*) FILTER (WHERE rejected_at IS NOT NULL)::INT AS rejected_requests_total,
        COUNT(*) FILTER (
          WHERE rejected_at IS NOT NULL
            AND rejected_at >= NOW() - INTERVAL '24 hours'
        )::INT AS rejected_requests_24h,
        COUNT(*) FILTER (
          WHERE rejected_at IS NOT NULL
            AND rejected_at >= NOW() - INTERVAL '7 days'
        )::INT AS rejected_requests_7d
      FROM expert_connection_queue
    `);

    // 2) Capacity (online only for capacity + slots; total experts kept separately)
    const capacity = await dbClient.query(`
      SELECT
        COUNT(*)::INT AS total_experts,
        COUNT(*) FILTER (WHERE ea.is_online = TRUE)::INT AS online_experts,

        -- Only online experts contribute to total capacity
        COALESCE(SUM(ea.max_concurrent_clients) FILTER (WHERE ea.is_online = TRUE), 0)::INT AS total_capacity_online,
        COALESCE(SUM(ea.current_active_clients) FILTER (WHERE ea.is_online = TRUE), 0)::INT AS active_load_online,

        -- Optional: keep global load too (debug/ops)
        COALESCE(SUM(ea.current_active_clients), 0)::INT AS active_load_all
      FROM expert_availability ea
      JOIN users u ON u.id = ea.expert_id
      WHERE LOWER(COALESCE(u.role, '')) = 'expert'
    `);

    // 3) Avg assignment wait (only cases that truly waited in queue)
    // We approximate "waited" by requiring: status moved from queued → assigned at some point.
    // Since you don't have a full event log, best proxy: assigned_at not null AND created_at < assigned_at
    // and created_at within 7d.
    const wait = await dbClient.query(`
      SELECT
        AVG(EXTRACT(EPOCH FROM (assigned_at - created_at)))::INT AS avg_assignment_wait_seconds
      FROM expert_connection_queue
      WHERE assigned_at IS NOT NULL
        AND assigned_at > created_at
        AND created_at >= NOW() - INTERVAL '7 days'
    `);

    // 4) Top reject reasons (7d)
    const topRejectReasons = await dbClient.query(`
      SELECT
        COALESCE(NULLIF(TRIM(rejected_reason), ''), '(no reason)') AS reason,
        COUNT(*)::INT AS count
      FROM expert_connection_queue
      WHERE rejected_at IS NOT NULL
        AND rejected_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1
      ORDER BY count DESC, reason ASC
      LIMIT 10
    `);

    await dbClient.query("COMMIT");

    const summaryRow = summary.rows[0] || {};
    const capacityRow = capacity.rows[0] || {};

    const totalCapacityOnline = Number(capacityRow.total_capacity_online || 0);
    const activeLoadOnline = Number(capacityRow.active_load_online || 0);

    return {
      queued_requests: Number(summaryRow.queued_requests || 0),
      offered_requests: Number(summaryRow.offered_requests || 0),
      assigned_requests: Number(summaryRow.assigned_requests || 0),
      connected_requests: Number(summaryRow.connected_requests || 0),

      rejected_requests_total: Number(summaryRow.rejected_requests_total || 0),
      rejected_requests_24h: Number(summaryRow.rejected_requests_24h || 0),
      rejected_requests_7d: Number(summaryRow.rejected_requests_7d || 0),
      top_rejection_reasons_7d: topRejectReasons.rows,

      total_experts: Number(capacityRow.total_experts || 0),
      online_experts: Number(capacityRow.online_experts || 0),

      total_capacity_online: totalCapacityOnline,
      active_load_online: activeLoadOnline,
      available_slots_online: Math.max(
        totalCapacityOnline - activeLoadOnline,
        0,
      ),

      // optional debug
      active_load_all: Number(capacityRow.active_load_all || 0),

      avg_assignment_wait_seconds:
        Number(wait.rows[0]?.avg_assignment_wait_seconds || 0) || null,
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function getMyOffers({ expertId }) {
  const result = await pool.query(
    `
      SELECT *
      FROM expert_connection_queue
      WHERE expert_id = $1
        AND status = 'offered'
      ORDER BY offered_at ASC NULLS LAST, created_at ASC, id ASC
      LIMIT 50
    `,
    [expertId],
  );

  return { offers: result.rows };
}

async function acceptOffer({ requestId, expertId }) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    // Lock request
    const q = await dbClient.query(
      `SELECT * FROM expert_connection_queue WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const row = q.rows[0];
    if (!row) throw httpError("Connection request not found", 404);

    // Must be offered to THIS expert
    if (Number(row.expert_id) !== Number(expertId)) {
      throw httpError("Access denied", 403);
    }

    if (row.status !== "offered") {
      throw httpError("Only offered requests can be accepted", 409);
    }

    // Offer expiry check
    if (row.offer_expires_at && new Date(row.offer_expires_at) < new Date()) {
      // expire it and move back to queue (simple behavior)
      const expired = await dbClient.query(
        `
          UPDATE expert_connection_queue
          SET
            status = 'queued',
            expert_id = NULL,
            offered_at = NULL,
            offer_expires_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `,
        [requestId],
      );

      await normalizeQueuePositions(dbClient);

      const payload = await serializeRequest(dbClient, expired.rows[0]);
      await dbClient.query("COMMIT");
      return { request: payload, expired: true };
    }

    // Capacity check (lock availability row)
    const lock = await dbClient.query(
      `
        SELECT *
        FROM expert_availability
        WHERE expert_id = $1
        FOR UPDATE
      `,
      [expertId],
    );
    const availability = lock.rows[0];
    if (!availability) throw httpError("Expert availability not found", 400);
    if (!availability.is_online) throw httpError("Expert is offline", 409);

    const freeSlots =
      Number(availability.max_concurrent_clients) -
      Number(availability.current_active_clients);

    if (freeSlots <= 0) {
      throw httpError("Expert has no free slots", 409);
    }

    // Mark assigned
    const updated = await dbClient.query(
      `
        UPDATE expert_connection_queue
        SET
          status = 'assigned',
          assigned_at = CURRENT_TIMESTAMP,
          position = NULL,
          estimated_wait_seconds = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [requestId],
    );

    // NOW increment load
    await dbClient.query(
      `
        UPDATE expert_availability
        SET
          current_active_clients = current_active_clients + 1,
          last_assigned_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE expert_id = $1
      `,
      [expertId],
    );

    await dbClient.query("COMMIT");

    // Notify client (push only, no store, no email)
    try {
      await notify.user(
        Number(updated.rows[0].client_id),
        {
          title: "Expert accepted your request",
          body: "Tap to connect now.",
          data: {
            type: "expert_connect_offer_accepted",
            expert_connect_request_id: updated.rows[0].id,
            client_user_id: Number(updated.rows[0].client_id),
            expert_user_id: Number(updated.rows[0].expert_id),
          },
          push: true,
          store: false,
          email: false,
        },
        "expert_connect.offer.accepted",
      );
    } catch (e) {
      console.error("notify client accepted failed:", e?.message || e);
    }

    return { request: await serializeRequest(dbClient, updated.rows[0]) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

async function rejectOffer({ requestId, expertId, reason }) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const q = await dbClient.query(
      `SELECT * FROM expert_connection_queue WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const row = q.rows[0];
    if (!row) throw httpError("Connection request not found", 404);

    if (Number(row.expert_id) !== Number(expertId)) {
      throw httpError("Access denied", 403);
    }

    if (row.status !== "offered") {
      throw httpError("Only offered requests can be rejected", 409);
    }

    // Move back to queue for reassignment
    const updated = await dbClient.query(
      `
        UPDATE expert_connection_queue
        SET
          status = 'queued',
          expert_id = NULL,
          offered_at = NULL,
          offer_expires_at = NULL,
          rejected_at = CURRENT_TIMESTAMP,
          rejected_reason = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [requestId, reason ? String(reason).slice(0, 500) : null],
    );

    await normalizeQueuePositions(dbClient);

    await dbClient.query("COMMIT");
    return { request: await serializeRequest(dbClient, updated.rows[0]) };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

// ✅ Active request for expert (use new STATUS_GROUPS)
async function getActiveRequestForExpert(client, expertId) {
  const result = await client.query(
    `
      SELECT *
      FROM expert_connection_queue
      WHERE expert_id = $1
        AND status = ANY($2::expert_connection_status[])
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [Number(expertId), STATUS_GROUPS.ACTIVE_EXPERT],
  );

  return result.rows[0] || null;
}

// ✅ Unified "my active request" for client/expert (polling endpoint backend helper)
async function getMyActiveRequest({ userId, role }) {
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const r = normalizeRole(role);

    let row = null;

    if (r === "client") {
      // uses STATUS_GROUPS.ACTIVE_CLIENT internally via getActiveRequestForClient()
      row = await getActiveRequestForClient(dbClient, Number(userId));
    } else if (r === "expert") {
      row = await getActiveRequestForExpert(dbClient, Number(userId));
    } else {
      row = null;
    }

    const payload = row ? await serializeRequest(dbClient, row) : null;

    await dbClient.query("COMMIT");

    return {
      has_active_request: Boolean(payload),
      request: payload,
    };
  } catch (err) {
    await dbClient.query("ROLLBACK");
    throw err;
  } finally {
    dbClient.release();
  }
}

// ✅ Expert offers list (use STATUS.OFFERED, serialize for frontend)
async function getMyOffers({ expertId }) {
  const dbClient = await pool.connect();

  try {
    const result = await dbClient.query(
      `
        SELECT *
        FROM expert_connection_queue
        WHERE expert_id = $1
          AND status = $2
          AND (offer_expires_at IS NULL OR offer_expires_at > NOW())
        ORDER BY offered_at ASC NULLS LAST, created_at ASC, id ASC
        LIMIT 50
      `,
      [Number(expertId), STATUS.OFFERED],
    );

    const offers = [];
    for (const row of result.rows) {
      offers.push(await serializeRequest(dbClient, row));
    }

    return { offers };
  } finally {
    dbClient.release();
  }
}

module.exports = {
  requestConnection,
  getRequestStatus,
  cancelRequest,
  setExpertOnlineStatus,
  markConnected,
  completeRequest,
  getQueueOverview,
  getMyOffers,
  acceptOffer,
  rejectOffer,
  getActiveRequestForExpert,
  getMyActiveRequest,
  getMyOffers,
};
