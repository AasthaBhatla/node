// routes/jobs.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const jobController = require("../controllers/jobController");

/**
 * Client:
 * - POST   /jobs                          create job (charges posting fee if applicable)
 * - GET    /jobs/me                       list my jobs (pagination; optional includeApplicants)
 * - GET    /jobs/me/:jobId                job detail (with applicants)
 * - POST   /jobs/:jobId/assign            assign to partner + hold escrow
 * - POST   /jobs/:jobId/approve-complete  client approves completion + release escrow
 *
 * Partner:
 * - GET    /jobs/open                     list open jobs to browse/apply (pagination)
 * - GET    /jobs/open/:jobId              open job detail (attachments etc.)
 * - GET    /jobs/partner/stats            partner dashboard stats
 * - GET    /jobs/partner/earnings         partner earnings breakup (pagination)
 * - POST   /jobs/:jobId/apply             apply or update application (one per job)
 * - POST   /jobs/:jobId/withdraw          withdraw application
 * - POST   /jobs/:jobId/mark-complete     partner requests completion
 */

// ------------------- Client APIs -------------------
router.post("/", authMiddleware, jobController.createJob);
router.get("/me", authMiddleware, jobController.listMyJobs);
router.get("/me/:jobId", authMiddleware, jobController.getMyJobDetail);
router.post("/:jobId/assign", authMiddleware, jobController.assignJob);
router.post(
  "/:jobId/approve-complete",
  authMiddleware,
  jobController.clientApproveComplete,
);

// ------------------- Partner browse APIs -------------------
// Keep static prefixes BEFORE "/:jobId/*" routes
router.get("/open", authMiddleware, jobController.listOpenJobs);
router.get("/open/:jobId", authMiddleware, jobController.getOpenJobDetail);

// ------------------- Partner dashboard APIs -------------------
router.get("/partner/stats", authMiddleware, jobController.partnerStats);
router.get("/partner/earnings", authMiddleware, jobController.partnerEarnings);

// ------------------- Partner action APIs -------------------
router.post("/:jobId/apply", authMiddleware, jobController.upsertApplication);
router.post(
  "/:jobId/withdraw",
  authMiddleware,
  jobController.withdrawApplication,
);
router.post(
  "/:jobId/mark-complete",
  authMiddleware,
  jobController.partnerMarkComplete,
);
router.get(
  "/partner/applied",
  authMiddleware,
  jobController.partnerAppliedJobs,
);
router.get(
  "/partner/running",
  authMiddleware,
  jobController.partnerRunningJobs,
);
router.get(
  "/partner/completed",
  authMiddleware,
  jobController.partnerCompletedJobs,
);

module.exports = router;
