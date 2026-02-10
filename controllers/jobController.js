// controllers/jobController.js
const jobService = require("../services/jobService");
const jobPartnerListsService = require("../services/jobPartnerListsService");

const notify = require("../services/notify");
const userService = require("../services/userService");
const pool = require("../db"); // used only to fetch job title + client/partner ids for notifications

const PARTNER_ROLES = new Set(["officer", "lawyer", "ngo", "expert"]);
// -------------------------------------
// Small response helpers (consistent)
// -------------------------------------
function success(res, body = {}, statusCode = 200) {
  return res.status(statusCode).json({ status: "success", body });
}

function displayFirstName(userObj, fallback = "Someone") {
  const first =
    userObj?.metadata?.first_name ||
    userObj?.metadata?.name ||
    userObj?.metadata?.display_name ||
    "";
  const v = String(first).trim();
  return v || fallback;
}

async function getJobMini(jobId) {
  const r = await pool.query(
    `SELECT id, title, client_id, assigned_partner_id, status
     FROM jobs
     WHERE id = $1
     LIMIT 1`,
    [parseInt(jobId, 10)],
  );
  return r.rows[0] || null;
}

function failure(
  res,
  message = "Something went wrong",
  statusCode = 400,
  extra = {},
) {
  return res.status(statusCode).json({
    status: "failure",
    body: { message, ...extra },
  });
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v || "")
    .toLowerCase()
    .trim();
  return ["1", "true", "yes", "y", "on"].includes(s);
}

function requirePartner(req, res) {
  const role = String(req.user?.role || "")
    .toLowerCase()
    .trim();

  if (!PARTNER_ROLES.has(role)) {
    failure(res, "Only partners can access this endpoint", 403);
    return false;
  }
  return true;
}

function requireClient(req, res) {
  // We treat anyone who is NOT partner as client (practical, keeps roles flexible).
  const role = String(req.user?.role || "")
    .toLowerCase()
    .trim();
  if (role === "partner") {
    failure(res, "Partners cannot access this endpoint", 403);
    return false;
  }
  return true;
}

// -------------------------------------
// Client APIs
// -------------------------------------
exports.createJob = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;

    const {
      title,
      case_description,
      case_type = null,
      location_id = null,
      urgency,
      budget_credits = 0,
      attachments = [],
      posting_fee_idempotency_key = null,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return failure(res, "title is required");
    }
    if (!case_description || !String(case_description).trim()) {
      return failure(res, "case_description is required");
    }
    if (!urgency) {
      return failure(res, "urgency is required");
    }
    if (location_id !== null && location_id !== undefined) {
      const n = parseInt(location_id, 10);
      if (!Number.isInteger(n) || n < 0) {
        return failure(res, "location_id must be a valid integer");
      }
    }

    const out = await jobService.createJob({
      clientId,
      title,
      case_description,
      case_type,
      location_id,
      urgency,
      budget_credits,
      attachments,
      posting_fee_idempotency_key,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to create job",
      err.statusCode || 500,
    );
  }
};

exports.listMyJobs = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;
    const includeApplicants = toBool(req.query.includeApplicants);

    const out = await jobService.listClientJobs({
      clientId,
      page,
      limit,
      includeApplicants,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to list jobs",
      err.statusCode || 500,
    );
  }
};

exports.getMyJobDetail = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;
    const jobId = req.params.jobId;

    const out = await jobService.getJobDetailForClient({ clientId, jobId });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch job",
      err.statusCode || 500,
    );
  }
};

exports.assignJob = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;
    const jobId = req.params.jobId;

    const { partner_id, escrow_idempotency_key } = req.body || {};
    if (!partner_id) return failure(res, "partner_id is required");

    const out = await jobService.assignJobAndHoldEscrow({
      clientId,
      jobId,
      partnerId: partner_id,
      escrow_idempotency_key: escrow_idempotency_key || null,
    });

    //Notify partner that they were assigned
    try {
      const job = await getJobMini(jobId);
      const client = await userService.getUserById(clientId);
      const clientName = displayFirstName(client, "A client");

      await notify.user(
        parseInt(partner_id, 10),
        {
          title: "Job Assigned To You",
          body: `${clientName} assigned you a job: ${job?.title || "Job"}.`,
          data: {
            type: "job_assigned",
            job_id: parseInt(jobId, 10),
            client_id: clientId,
          },
          push: true,
          store: true,
        },
        "jobs.assigned",
      );
    } catch (e) {
      console.error("Notify partner (job assigned) failed:", e.message || e);
    }

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to assign job",
      err.statusCode || 500,
    );
  }
};

exports.clientApproveComplete = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;
    const jobId = req.params.jobId;

    const { release_idempotency_key } = req.body || {};

    const out = await jobService.clientApproveCompleteAndRelease({
      clientId,
      jobId,
      release_idempotency_key: release_idempotency_key || null,
    });

    // ✅ Notify partner payout approved
    try {
      const job = await getJobMini(jobId);
      const partnerId = job?.assigned_partner_id;

      if (partnerId) {
        const client = await userService.getUserById(clientId);
        const clientName = displayFirstName(client, "The client");

        await notify.user(
          partnerId,
          {
            title: "Job Completed",
            body: `${clientName} approved completion for: ${job?.title || "Job"}.`,
            data: {
              type: "job_completion_approved",
              job_id: parseInt(jobId, 10),
              client_id: clientId,
            },
            push: true,
            store: true,
          },
          "jobs.completion.approved",
        );
      }
    } catch (e) {
      console.error(
        "Notify partner (client approved completion) failed:",
        e.message || e,
      );
    }

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to approve completion",
      err.statusCode || 500,
    );
  }
};

// -------------------------------------
// Partner APIs
// -------------------------------------
exports.upsertApplication = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const jobId = req.params.jobId;

    const { quote_credits, message = null } = req.body || {};
    if (!quote_credits) return failure(res, "quote_credits is required");

    const out = await jobService.upsertJobApplication({
      partnerId,
      jobId,
      quote_credits,
      message,
    });

    // Notify client that a partner applied
    try {
      const job = await getJobMini(jobId);
      if (job?.client_id) {
        const partner = await userService.getUserById(partnerId);
        const partnerName = displayFirstName(partner, "A partner");

        await notify.user(
          job.client_id,
          {
            title: "New Job Application",
            body: `${partnerName} applied to your job: ${job.title || "Job"}.`,
            data: {
              type: "job_application_created",
              job_id: job.id,
              partner_id: partnerId,
              quote_credits: Number.parseInt(quote_credits, 10),
            },
            push: true,
            store: true,
          },
          "jobs.application.created",
        );
      }
    } catch (e) {
      console.error("Notify client (partner applied) failed:", e.message || e);
    }

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to apply",
      err.statusCode || 500,
    );
  }
};

exports.withdrawApplication = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const jobId = req.params.jobId;

    const out = await jobService.withdrawJobApplication({ partnerId, jobId });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to withdraw application",
      err.statusCode || 500,
    );
  }
};

exports.partnerMarkComplete = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const jobId = req.params.jobId;

    const out = await jobService.partnerMarkComplete({ partnerId, jobId });

    // Notify client that completion was requested
    try {
      const job = await getJobMini(jobId);
      if (job?.client_id) {
        const partner = await userService.getUserById(partnerId);
        const partnerName = displayFirstName(partner, "Your partner");

        await notify.user(
          job.client_id,
          {
            title: "Completion Requested",
            body: `${partnerName} marked the job as complete: ${job.title || "Job"}.`,
            data: {
              type: "job_completion_requested",
              job_id: job.id,
              partner_id: partnerId,
            },
            push: true,
            store: true,
          },
          "jobs.completion.requested",
        );
      }
    } catch (e) {
      console.error(
        "Notify client (partner marked complete) failed:",
        e.message || e,
      );
    }

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to mark complete",
      err.statusCode || 500,
    );
  }
};

exports.partnerStats = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;

    const out = await jobService.getPartnerStats({ partnerId });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch stats",
      err.statusCode || 500,
    );
  }
};

exports.partnerEarnings = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;

    const out = await jobService.listPartnerEarnings({
      partnerId,
      page,
      limit,
    });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch earnings",
      err.statusCode || 500,
    );
  }
};

// -------------------------------------
// Partner job lists (applied / running / completed)
// -------------------------------------
exports.partnerAppliedJobs = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;

    const out = await jobPartnerListsService.listPartnerAppliedJobs({
      partnerId,
      page,
      limit,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch applied jobs",
      err.statusCode || 500,
    );
  }
};

exports.partnerRunningJobs = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;

    const out = await jobPartnerListsService.listPartnerRunningJobs({
      partnerId,
      page,
      limit,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch running jobs",
      err.statusCode || 500,
    );
  }
};

exports.partnerCompletedJobs = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;

    const out = await jobPartnerListsService.listPartnerCompletedJobs({
      partnerId,
      page,
      limit,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch completed jobs",
      err.statusCode || 500,
    );
  }
};

// -------------------------------------
// Optional partner browsing APIs (if you add routes)
// GET /jobs/open
// GET /jobs/open/:jobId
// -------------------------------------
exports.listOpenJobs = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;

    const out = await jobService.listOpenJobs({ partnerId, page, limit });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to list open jobs",
      err.statusCode || 500,
    );
  }
};

exports.getOpenJobDetail = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const jobId = req.params.jobId;

    const out = await jobService.getJobDetailForPartner({ partnerId, jobId });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch job detail",
      err.statusCode || 500,
    );
  }
};
