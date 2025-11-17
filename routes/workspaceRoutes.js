const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const workspaceController = require("../controllers/workspaceController");

router.post("/", authMiddleware, workspaceController.create);
router.get("/", authMiddleware, workspaceController.getMyWorkspaces);
router.post("/:id", authMiddleware, workspaceController.update);
router.delete("/:id", authMiddleware, workspaceController.delete);
router.post("/:id/metadata", authMiddleware, workspaceController.updateMetadata);
router.get("/:id/metadata", authMiddleware, workspaceController.getMetadata);
router.delete("/:id/metadata", authMiddleware, workspaceController.deleteMetadata);

module.exports = router;
