const db = require('../db');

async function insertRequest(data) {
  const { client_id, partner_id, title, description, category_id } = data;
  const result = await db.query(
    `INSERT INTO requests (client_id, partner_id, title, description, category_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [client_id, partner_id, title, description, category_id]
  );
  return result.rows[0];
}

async function getRequestsByUser(userId) {
  const result = await db.query(
    `SELECT r.*, t.title AS category_title
     FROM requests r
     LEFT JOIN terms t ON r.category_id = t.id
     WHERE r.client_id = $1 OR r.partner_id = $1`,
    [userId]
  );
  return result.rows;
}

async function getRequestById(id) {
  const result = await db.query(
    `SELECT r.*, t.title AS category_title
     FROM requests r
     LEFT JOIN terms t ON r.category_id = t.id
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0];
}

async function updateRequestById(id, updates) {
  const fields = [];
  const values = [];
  let i = 1;

  for (let key in updates) {
    fields.push(`${key} = $${i++}`);
    values.push(updates[key]);
  }

  values.push(id);

  const result = await db.query(
    `UPDATE requests SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${i} RETURNING *`,
    values
  );
  return result.rows[0];
}

async function assignPartner(id, partnerId) {
  const result = await db.query(
    `UPDATE requests 
     SET partner_id = $1, updated_at = CURRENT_TIMESTAMP 
     WHERE id = $2 RETURNING *`,
    [partnerId, id]
  );
  return result.rows[0];
}


async function acceptRequest(requestId, partnerId) {
  const result = await db.query(
    `UPDATE requests 
     SET status = 'accepted', partner_id = $2, replied_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [requestId, partnerId]
  );
  return result.rows[0];
}

async function rejectRequest(requestId,partnerId) {
  const result = await db.query(
    `UPDATE requests SET status = 'rejected', partner_id = $2, replied_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [requestId,partnerId]
  );
  return result.rows[0];
}

async function updateStatus(requestId, status) {
  const result = await db.query(
    `UPDATE requests SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 RETURNING *`,
    [status, requestId]
  );
  return result.rows[0];
}

async function getAllRequestCategories() {
  const result = await db.query(
    `SELECT * FROM terms WHERE taxonomy_id = (
      SELECT id FROM taxonomy WHERE slug = 'category' LIMIT 1
    )`
  );
  return result.rows;
}

async function deleteRequest(id) {
  await db.query(`DELETE FROM requests WHERE id = $1`, [id]);
  return { message: 'Request deleted' };
}

module.exports = {
  insertRequest,
  getRequestsByUser,
  getRequestById,
  updateRequestById,
  assignPartner,
  acceptRequest,
  rejectRequest,
  updateStatus,
  getAllRequestCategories,
  deleteRequest
};
