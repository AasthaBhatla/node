const {
  createWorkspace,
  updateWorkspaceTitle,
  deleteWorkspace,
  getWorkspacesWithMetadata,
  upsertWorkspaceMetadata,
  getWorkspaceMetadata,
  deleteWorkspaceMetadata,
} = require("../services/workspaceService");

const isAllowed = (user) => {
  return user && ["client", "admin"].includes(user.role?.toLowerCase());
};

exports.create = async (req, res) => {
  try {
    const user = req.user;
    if (!isAllowed(user)) {
      return res
        .status(403)
        .json({ error: "Access denied. Only User & Admin allowed." });
    }

    const { type, title, metadata } = req.body;
    if (!type || !title) {
      return res.status(400).json({ error: "type and title are required" });
    }

    const workspace = await createWorkspace(user.id, type, title);

    let metaRows = [];
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      metaRows = await upsertWorkspaceMetadata(workspace.id, metadata);
    }

    const meta = metaRows; // or `await getWorkspaceMetadata(workspace.id);`

    return res.status(201).json({
      message: "Workspace created successfully",
      data: { ...workspace, metadata: meta },
    });
  } catch (err) {
    console.error("Create Workspace Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getMyWorkspaces = async (req, res) => {
  try {
    const user = req.user;
    if (!isAllowed(user)) {
      return res
        .status(403)
        .json({ error: "Access denied. Only User & Admin allowed." });
    }

    const workspaces = await getWorkspacesWithMetadata(user.id);
    return res.status(200).json(workspaces);
  } catch (err) {
    console.error("Get Workspaces Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const user = req.user;
    if (!isAllowed(user)) {
      return res
        .status(403)
        .json({ error: "Access denied. Only User & Admin allowed." });
    }

    const workspaceId = parseInt(req.params.id);
    const { title } = req.body;

    if (!workspaceId || !title) {
      return res
        .status(400)
        .json({ error: "workspaceId and title are required" });
    }

    const updated = await updateWorkspaceTitle(workspaceId, user.id, title);

    if (!updated) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    const metadata = await getWorkspaceMetadata(workspaceId);

    return res.status(200).json({
      message: "Workspace updated successfully",
      data: { ...updated, metadata },
    });
  } catch (err) {
    console.error("Update Workspace Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.delete = async (req, res) => {
  try {
    const user = req.user;
    if (!isAllowed(user)) {
      return res
        .status(403)
        .json({ error: "Access denied. Only User & Admin allowed." });
    }

    const workspaceId = parseInt(req.params.id);

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required" });
    }

    const deleted = await deleteWorkspace(workspaceId, user.id);

    if (!deleted) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    return res.status(200).json({ message: "Workspace deleted successfully" });
  } catch (err) {
    console.error("Delete Workspace Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.updateMetadata = async (req, res) => {
  try {
    const user = req.user;
    if (!isAllowed(user)) {
      return res
        .status(403)
        .json({ error: "Access denied. Only User & Admin allowed." });
    }

    const workspaceId = parseInt(req.params.id, 10);
    const body = req.body;

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required" });
    }

    let items = [];

    // If body is an array -> bulk
    if (Array.isArray(body)) {
      if (body.length === 0) {
        return res
          .status(400)
          .json({ error: "Metadata array cannot be empty" });
      }
      items = body;
    } else {
      // Single object -> wrap in array
      const { key, value } = body || {};
      if (!key) {
        return res
          .status(400)
          .json({ error: "workspaceId and key are required" });
      }
      items = [{ key, value }];
    }

    const rows = await upsertWorkspaceMetadata(workspaceId, items);

    return res.status(200).json({
      message: "Metadata saved successfully",
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error("Update Metadata Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getMetadata = async (req, res) => {
  try {
    const user = req.user;
    if (!isAllowed(user)) {
      return res
        .status(403)
        .json({ error: "Access denied. Only User & Admin allowed." });
    }

    const workspaceId = parseInt(req.params.id);
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required" });
    }

    const metadata = await getWorkspaceMetadata(workspaceId);
    res.status(200).json({ success: true, data: metadata });
  } catch (err) {
    console.error("Get Metadata Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteMetadata = async (req, res) => {
  try {
    const user = req.user;
    if (!isAllowed(user)) {
      return res
        .status(403)
        .json({ error: "Access denied. Only User & Admin allowed." });
    }

    const workspaceId = parseInt(req.params.id);
    const { key } = req.body;

    if (!workspaceId || !key) {
      return res
        .status(400)
        .json({ error: "workspaceId and key are required" });
    }

    const deleted = await deleteWorkspaceMetadata(workspaceId, key);

    if (!deleted) {
      return res.status(404).json({ error: "Metadata key not found" });
    }

    return res.status(200).json({ message: "Metadata deleted successfully" });
  } catch (err) {
    console.error("Delete Metadata Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
