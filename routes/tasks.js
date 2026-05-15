// routes/tasks.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const taskController = require("../controllers/taskController");

/**
 * Client:
 * - POST   /tasks                          create task (charges posting fee if applicable)
 * - GET    /tasks/me                       list my tasks (pagination; optional includeApplicants)
 * - GET    /tasks/me/:taskId                task detail (with applicants)
 * - POST   /tasks/:taskId/assign            assign to partner + hold escrow
 * - POST   /tasks/:taskId/approve-complete  client approves completion + release escrow
 *
 * Partner:
 * - GET    /tasks/open                     list open tasks to browse/apply (pagination)
 * - GET    /tasks/open/:taskId              open task detail (attachments etc.)
 * - GET    /tasks/partner/stats            partner dashboard stats
 * - GET    /tasks/partner/earnings         partner earnings breakup (pagination)
 * - GET    /tasks/partner/platform-status  editable partner footer overlay metrics
 * - POST   /tasks/:taskId/apply             apply or update application (one per task)
 * - POST   /tasks/:taskId/withdraw          withdraw application
 * - POST   /tasks/:taskId/mark-complete     partner requests completion
 */

// ------------------- Client APIs -------------------
router.post("/", authMiddleware, taskController.createTask);
router.get("/me", authMiddleware, taskController.listMyTasks);
router.get("/me/:taskId", authMiddleware, taskController.getMyTaskDetail);
router.post("/:taskId/assign", authMiddleware, taskController.assignTask);
router.post(
  "/:taskId/approve-complete",
  authMiddleware,
  taskController.clientApproveComplete,
);

// ------------------- Partner browse APIs -------------------
// Keep static prefixes BEFORE "/:taskId/*" routes
router.get("/open", authMiddleware, taskController.listOpenTasks);
router.get("/open/:taskId", authMiddleware, taskController.getOpenTaskDetail);

// ------------------- Partner dashboard APIs -------------------
router.get("/partner/stats", authMiddleware, taskController.partnerStats);
router.get("/partner/earnings", authMiddleware, taskController.partnerEarnings);
router.get(
  "/partner/platform-status",
  authMiddleware,
  taskController.partnerPlatformStatus,
);

// ------------------- Admin APIs -------------------
router.get("/admin", authMiddleware, requireAdmin(), taskController.adminListTasks);
router.get(
  "/admin/:taskId",
  authMiddleware,
  requireAdmin(),
  taskController.adminGetTaskDetail,
);

// ------------------- Partner action APIs -------------------
router.post("/:taskId/apply", authMiddleware, taskController.upsertApplication);
router.post(
  "/:taskId/withdraw",
  authMiddleware,
  taskController.withdrawApplication,
);
router.post(
  "/:taskId/mark-complete",
  authMiddleware,
  taskController.partnerMarkComplete,
);
router.get(
  "/partner/applied",
  authMiddleware,
  taskController.partnerAppliedTasks,
);
router.get(
  "/partner/running",
  authMiddleware,
  taskController.partnerRunningTasks,
);
router.get(
  "/partner/completed",
  authMiddleware,
  taskController.partnerCompletedTasks,
);

module.exports = router;
