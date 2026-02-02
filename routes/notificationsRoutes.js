// routes/notificationsRoutes.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const pool = require("../db");

// All routes require login
router.use(authMiddleware);

/**
 * GET /notifications
 * Query:
 *  - page (default 1)
 *  - limit (default 20, max 100)
 *  - status: "unread" | "read" (optional)
 */
router.get("/", async (req, res) => {
  try {
    const userId = Number(req.user.id);

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limitRaw = parseInt(req.query.limit || "20", 10);
    const limit = Math.min(100, Math.max(1, limitRaw));
    const offset = (page - 1) * limit;

    const status = String(req.query.status || "")
      .toLowerCase()
      .trim();
    const allowedStatus = new Set(["unread", "read"]);
    const hasStatusFilter = allowedStatus.has(status);

    const params = [userId];
    let where = `WHERE user_id = $1`;

    if (hasStatusFilter) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }

    // Total count for pagination
    const countSql = `SELECT COUNT(*)::int AS total FROM notifications ${where}`;
    const countResult = await pool.query(countSql, params);
    const total = countResult.rows[0]?.total || 0;

    // Data
    params.push(limit);
    params.push(offset);

    const dataSql = `
      SELECT id, title, body, data, channel, status, created_at, read_at, job_id
      FROM notifications
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const { rows } = await pool.query(dataSql, params);

    res.status(200).json({
      status: "success",
      body: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
        items: rows,
      },
    });
  } catch (err) {
    console.error("GET /notifications error:", err);
    res.status(500).json({
      status: "failure",
      body: { message: "Failed to fetch notifications" },
    });
  }
});

/**
 * GET /notifications/unread-count
 */
router.get("/unread-count", async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS unread
       FROM notifications
       WHERE user_id = $1 AND status = 'unread'`,
      [userId],
    );

    res.status(200).json({
      status: "success",
      body: { unread: rows[0]?.unread || 0 },
    });
  } catch (err) {
    console.error("GET /notifications/unread-count error:", err);
    res.status(500).json({
      status: "failure",
      body: { message: "Failed to fetch unread count" },
    });
  }
});

/**
 * POST /notifications/mark-read
 * Body options:
 *  A) { "ids": [1,2,3] }        -> mark only these as read (must belong to user)
 *  B) { "all": true }          -> mark ALL unread as read
 * Optional:
 *  - return_unread_count: true  -> returns fresh unread count
 */
router.post("/mark-read", async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = Number(req.user.id);
    const { ids, all, return_unread_count } = req.body || {};

    const markAll = all === true;

    let updated = 0;

    await client.query("BEGIN");

    if (markAll) {
      const result = await client.query(
        `UPDATE notifications
         SET status = 'read', read_at = NOW()
         WHERE user_id = $1 AND status = 'unread'
         RETURNING id`,
        [userId],
      );
      updated = result.rowCount || 0;
    } else {
      const parsedIds = (Array.isArray(ids) ? ids : [])
        .map((x) => parseInt(x, 10))
        .filter(Number.isFinite);

      if (!parsedIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          status: "failure",
          body: { message: "Provide ids[] or all=true" },
        });
      }

      const result = await client.query(
        `UPDATE notifications
         SET status = 'read', read_at = NOW()
         WHERE user_id = $1
           AND status = 'unread'
           AND id = ANY($2::int[])
         RETURNING id`,
        [userId, parsedIds],
      );
      updated = result.rowCount || 0;
    }

    await client.query("COMMIT");

    let unread = null;
    if (return_unread_count === true) {
      const c = await pool.query(
        `SELECT COUNT(*)::int AS unread
         FROM notifications
         WHERE user_id = $1 AND status = 'unread'`,
        [userId],
      );
      unread = c.rows[0]?.unread || 0;
    }

    res.status(200).json({
      status: "success",
      body: { updated, ...(unread !== null ? { unread } : {}) },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /notifications/mark-read error:", err);
    res.status(500).json({
      status: "failure",
      body: { message: "Failed to mark notifications as read" },
    });
  } finally {
    client.release();
  }
});

module.exports = router;
