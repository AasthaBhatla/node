const pool = require("../db");

const createWorkspace = async (userId, type, title) => {
  try {
    const result = await pool.query(
      `INSERT INTO workspace (user_id, type, title)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, type, title]
    );
    return result.rows[0];
  } catch (err) {
    console.error("Error in createWorkspace:", err);
    throw new Error("Error creating workspace");
  }
};

const updateWorkspaceTitle = async (workspaceId, userId, title) => {
  try {
    const result = await pool.query(
      `UPDATE workspace
       SET title = $3
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [workspaceId, userId, title]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("Error in updateWorkspaceTitle:", err);
    throw new Error("Error updating workspace");
  }
};

const deleteWorkspace = async (workspaceId, userId) => {
  try {
    await pool.query(
      `DELETE FROM workspace_metadata
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const result = await pool.query(
      `DELETE FROM workspace
       WHERE id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );

    return result.rowCount > 0;
  } catch (err) {
    console.error("Error in deleteWorkspace:", err);
    throw new Error("Error deleting workspace");
  }
};

const getWorkspacesWithMetadata = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT 
        w.id AS workspace_id,
        w.user_id,
        w.type,
        w.title,
        w.created_at,
        m.meta_key,
        m.meta_value
      FROM workspace w
      LEFT JOIN workspace_metadata m
        ON m.workspace_id = w.id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC`,
      [userId]
    );

    const map = new Map();

    for (const row of result.rows) {
      if (!map.has(row.workspace_id)) {
        map.set(row.workspace_id, {
          id: row.workspace_id,
          user_id: row.user_id,
          type: row.type,
          title: row.title,
          created_at: row.created_at,
          metadata: {},
        });
      }
      if (row.meta_key) {
        map.get(row.workspace_id).metadata[row.meta_key] = row.meta_value;
      }
    }

    return Array.from(map.values());
  } catch (err) {
    console.error("Error in getWorkspacesWithMetadata:", err);
    throw new Error("Error fetching workspaces");
  }
};

const getWorkspaceByIdWithMetadata = async (workspaceId, userId) => {
  const result = await pool.query(
    `SELECT 
      w.id AS workspace_id,
      w.user_id,
      w.type,
      w.title,
      w.created_at,
      m.meta_key,
      m.meta_value
    FROM workspace w
    LEFT JOIN workspace_metadata m
      ON m.workspace_id = w.id
    WHERE w.id = $1 AND w.user_id = $2`,
    [workspaceId, userId]
  );

  if (result.rows.length === 0) return null;

  const first = result.rows[0];

  const workspace = {
    id: first.workspace_id,
    user_id: first.user_id,
    type: first.type,
    title: first.title,
    created_at: first.created_at,
    metadata: {},
  };

  for (const row of result.rows) {
    if (row.meta_key) workspace.metadata[row.meta_key] = row.meta_value;
  }

  return workspace;
};

const upsertWorkspaceMetadata = async (workspaceId, items = []) => {
  try {
    if (!Array.isArray(items)) return [];

    // Expect items: [{ key, value }, ...]
    const cleaned = items
      .filter((it) => it && typeof it === "object")
      .map(({ key, value }) => ({
        key: key != null ? String(key).trim() : "",
        value: value === undefined ? null : String(value),
      }))
      .filter((it) => it.key !== "");

    if (cleaned.length === 0) return [];

    const values = [workspaceId]; // $1
    const rowsPlaceholders = [];
    let paramIndex = 2;

    for (const { key, value } of cleaned) {
      rowsPlaceholders.push(`($1, $${paramIndex}, $${paramIndex + 1})`);
      values.push(key, value);
      paramIndex += 2;
    }

    const query = `
      INSERT INTO workspace_metadata (workspace_id, meta_key, meta_value)
      VALUES ${rowsPlaceholders.join(", ")}
      ON CONFLICT (workspace_id, meta_key)
      DO UPDATE SET meta_value = EXCLUDED.meta_value
      RETURNING *;
    `;

    const { rows } = await pool.query(query, values);
    return rows;
  } catch (err) {
    console.error("Error in upsertWorkspaceMetadata:", err);
    throw new Error("Error updating metadata");
  }
};

const getWorkspaceMetadata = async (workspaceId) => {
  try {
    const result = await pool.query(
      `SELECT meta_key, meta_value
       FROM workspace_metadata
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const metadata = {};
    for (const row of result.rows) {
      metadata[row.meta_key] = row.meta_value;
    }

    return metadata;
  } catch (err) {
    console.error("Error in getWorkspaceMetadata:", err);
    throw new Error("Error fetching metadata");
  }
};

const deleteWorkspaceMetadata = async (workspaceId, key) => {
  try {
    const result = await pool.query(
      `DELETE FROM workspace_metadata
       WHERE workspace_id = $1 AND meta_key = $2`,
      [workspaceId, key]
    );
    return result.rowCount > 0;
  } catch (err) {
    console.error("Error in deleteWorkspaceMetadata:", err);
    throw new Error("Error deleting metadata");
  }
};

module.exports = {
  createWorkspace,
  updateWorkspaceTitle,
  deleteWorkspace,
  getWorkspacesWithMetadata,
  upsertWorkspaceMetadata,
  getWorkspaceMetadata,
  deleteWorkspaceMetadata,
  getWorkspaceByIdWithMetadata,
};
