// controllers/taskController.js
const taskService = require("../services/taskService");
const taskPartnerListsService = require("../services/taskPartnerListsService");
const { getPartnerPlatformStatus } = require("../services/adminConfigService");

const notify = require("../services/notify");
const userService = require("../services/userService");
const pool = require("../db"); // used only to fetch task title + client/partner ids for notifications

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

async function getTaskMini(taskId) {
  const r = await pool.query(
    `SELECT id, title, client_id, assigned_partner_id, status
     FROM tasks
     WHERE id = $1
     LIMIT 1`,
    [parseInt(taskId, 10)],
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
exports.createTask = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;

    const {
      title,
      case_description,
      description,
      case_type = null,
      category_term_id = null,
      type_term_id = null,
      location_id = null,
      urgency,
      execution_mode = null,
      registration_required = false,
      notarisation_required = false,
      budget_credits = 0,
      attachments = [],
      posting_fee_idempotency_key = null,
      metadata = {},
    } = req.body || {};
    const taskDescription = case_description || description;

    if (!title || !String(title).trim()) {
      return failure(res, "title is required");
    }
    if (!taskDescription || !String(taskDescription).trim()) {
      return failure(res, "description is required");
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

    const out = await taskService.createTask({
      clientId,
      title,
      case_description: taskDescription,
      case_type,
      category_term_id,
      type_term_id,
      location_id,
      urgency,
      execution_mode,
      registration_required,
      notarisation_required,
      budget_credits,
      attachments,
      posting_fee_idempotency_key,
      metadata,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to create task",
      err.statusCode || 500,
    );
  }
};

exports.listMyTasks = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;
    const includeApplicants = toBool(req.query.includeApplicants);

    const out = await taskService.listClientTasks({
      clientId,
      page,
      limit,
      includeApplicants,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to list tasks",
      err.statusCode || 500,
    );
  }
};

exports.getMyTaskDetail = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;
    const taskId = req.params.taskId;

    const out = await taskService.getTaskDetailForClient({ clientId, taskId });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch task",
      err.statusCode || 500,
    );
  }
};

exports.assignTask = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;
    const taskId = req.params.taskId;

    const { partner_id, escrow_idempotency_key } = req.body || {};
    if (!partner_id) return failure(res, "partner_id is required");

    const out = await taskService.assignTaskAndHoldEscrow({
      clientId,
      taskId,
      partnerId: partner_id,
      escrow_idempotency_key: escrow_idempotency_key || null,
    });

    //Notify partner that they were assigned
    try {
      const task = await getTaskMini(taskId);
      const client = await userService.getUserById(clientId);
      const clientName = displayFirstName(client, "A client");

      await notify.user(
        parseInt(partner_id, 10),
        {
          title: "Task Assigned To You",
          body: `${clientName} assigned you a task: ${task?.title || "Task"}.`,
          data: {
            type: "task_assigned",
            task_id: parseInt(taskId, 10),
            client_id: clientId,
          },
          push: true,
          store: true,
        },
        "tasks.assigned",
      );
    } catch (e) {
      console.error("Notify partner (task assigned) failed:", e.message || e);
    }

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to assign task",
      err.statusCode || 500,
    );
  }
};

exports.clientApproveComplete = async (req, res) => {
  try {
    if (!requireClient(req, res)) return;

    const clientId = req.user.id;
    const taskId = req.params.taskId;

    const { release_idempotency_key } = req.body || {};

    const out = await taskService.clientApproveCompleteAndRelease({
      clientId,
      taskId,
      release_idempotency_key: release_idempotency_key || null,
    });

    // ✅ Notify partner payout approved
    try {
      const task = await getTaskMini(taskId);
      const partnerId = task?.assigned_partner_id;

      if (partnerId) {
        const client = await userService.getUserById(clientId);
        const clientName = displayFirstName(client, "The client");

        await notify.user(
          partnerId,
          {
            title: "Task Completed",
            body: `${clientName} approved completion for: ${task?.title || "Task"}.`,
            data: {
              type: "task_completion_approved",
              task_id: parseInt(taskId, 10),
              client_id: clientId,
            },
            push: true,
            store: true,
          },
          "tasks.completion.approved",
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
    const taskId = req.params.taskId;

    const { quote_credits, message = null } = req.body || {};
    if (!quote_credits) return failure(res, "quote_credits is required");

    const out = await taskService.upsertTaskApplication({
      partnerId,
      taskId,
      quote_credits,
      message,
    });

    // Notify client that a partner applied
    try {
      const task = await getTaskMini(taskId);
      if (task?.client_id) {
        const partner = await userService.getUserById(partnerId);
        const partnerName = displayFirstName(partner, "A partner");

        await notify.user(
          task.client_id,
          {
            title: "New Task Application",
            body: `${partnerName} applied to your task: ${task.title || "Task"}.`,
            data: {
              type: "task_application_created",
              task_id: task.id,
              partner_id: partnerId,
              quote_credits: Number.parseInt(quote_credits, 10),
            },
            push: true,
            store: true,
          },
          "tasks.application.created",
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
    const taskId = req.params.taskId;

    const out = await taskService.withdrawTaskApplication({ partnerId, taskId });
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
    const taskId = req.params.taskId;

    const out = await taskService.partnerMarkComplete({ partnerId, taskId });

    // Notify client that completion was requested
    try {
      const task = await getTaskMini(taskId);
      if (task?.client_id) {
        const partner = await userService.getUserById(partnerId);
        const partnerName = displayFirstName(partner, "Your partner");

        await notify.user(
          task.client_id,
          {
            title: "Completion Requested",
            body: `${partnerName} marked the task as complete: ${task.title || "Task"}.`,
            data: {
              type: "task_completion_requested",
              task_id: task.id,
              partner_id: partnerId,
            },
            push: true,
            store: true,
          },
          "tasks.completion.requested",
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

    const out = await taskService.getPartnerStats({ partnerId });
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

    const out = await taskService.listPartnerEarnings({
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

exports.partnerPlatformStatus = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const out = await getPartnerPlatformStatus();
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch platform status",
      err.statusCode || 500,
    );
  }
};

// -------------------------------------
// Admin APIs
// -------------------------------------
exports.adminListTasks = async (req, res) => {
  try {
    const out = await taskService.listAdminTasks({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      q: req.query.q || req.query.search,
    });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch tasks",
      err.statusCode || 500,
    );
  }
};

exports.adminGetTaskDetail = async (req, res) => {
  try {
    const out = await taskService.getTaskDetailForAdmin({
      taskId: req.params.taskId,
    });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch task",
      err.statusCode || 500,
    );
  }
};

// -------------------------------------
// Partner task lists (applied / running / completed)
// -------------------------------------
exports.partnerAppliedTasks = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;

    const out = await taskPartnerListsService.listPartnerAppliedTasks({
      partnerId,
      page,
      limit,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch applied tasks",
      err.statusCode || 500,
    );
  }
};

exports.partnerRunningTasks = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;

    const out = await taskPartnerListsService.listPartnerRunningTasks({
      partnerId,
      page,
      limit,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch running tasks",
      err.statusCode || 500,
    );
  }
};

exports.partnerCompletedTasks = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;

    const out = await taskPartnerListsService.listPartnerCompletedTasks({
      partnerId,
      page,
      limit,
    });

    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch completed tasks",
      err.statusCode || 500,
    );
  }
};

// -------------------------------------
// Optional partner browsing APIs (if you add routes)
// GET /tasks/open
// GET /tasks/open/:taskId
// -------------------------------------
exports.listOpenTasks = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const page = req.query.page;
    const limit = req.query.limit;
    const {
      q,
      category_term_ids,
      categories,
      type_term_ids,
      types,
      location_ids,
      jurisdictions,
      registration_required,
      notarisation_required,
      execution_mode,
      execution,
    } = req.query;

    const out = await taskService.listOpenTasks({
      partnerId,
      page,
      limit,
      q,
      category_term_ids,
      categories,
      type_term_ids,
      types,
      location_ids,
      jurisdictions,
      registration_required,
      notarisation_required,
      execution_mode,
      execution,
    });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to list open tasks",
      err.statusCode || 500,
    );
  }
};

exports.getOpenTaskDetail = async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;

    const partnerId = req.user.id;
    const taskId = req.params.taskId;

    const out = await taskService.getTaskDetailForPartner({ partnerId, taskId });
    return success(res, out, 200);
  } catch (err) {
    return failure(
      res,
      err.message || "Failed to fetch task detail",
      err.statusCode || 500,
    );
  }
};
