const pool = require("../db");

async function storeNotification(
  userId,
  { title, body, data = {}, channel = "push", job_id = null },
) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, title, body, data, channel, status, job_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, 'unread', $6)
     ON CONFLICT (user_id, job_id) WHERE job_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [userId, title, body, JSON.stringify(data || {}), channel, job_id],
  );

  // If duplicate, rows will be empty (DO NOTHING) — that's correct.
  return rows[0] || null;
}

async function listUserNotifications(userId, page = 1, limit = 10) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (safePage - 1) * safeLimit;

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1`,
    [userId],
  );
  const total = countRes.rows[0]?.total || 0;

  const listRes = await pool.query(
    `SELECT id, title, body, data, channel, status, created_at, read_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, safeLimit, offset],
  );

  return {
    notifications: listRes.rows,
    page: safePage,
    limit: safeLimit,
    total,
  };
}

async function markNotificationRead(userId, notificationId) {
  const { rows } = await pool.query(
    `UPDATE notifications
     SET status = 'read', read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'unread'
     RETURNING id, status, read_at`,
    [notificationId, userId],
  );
  return rows[0] || null;
}

async function markAllRead(userId) {
  const res = await pool.query(
    `UPDATE notifications
     SET status = 'read', read_at = NOW()
     WHERE user_id = $1 AND status = 'unread'`,
    [userId],
  );
  return res.rowCount || 0;
}

async function markManyRead(userId, ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const res = await pool.query(
    `UPDATE notifications
     SET status = 'read', read_at = NOW()
     WHERE user_id = $1 AND status = 'unread' AND id = ANY($2::int[])`,
    [userId, ids],
  );
  return res.rowCount || 0;
}

async function getUnreadCount(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS unread
     FROM notifications
     WHERE user_id = $1 AND status = 'unread'`,
    [userId],
  );
  return rows[0]?.unread || 0;
}

module.exports = {
  storeNotification,
  listUserNotifications,
  markNotificationRead,
  markAllRead,
  markManyRead,
  getUnreadCount,
};
