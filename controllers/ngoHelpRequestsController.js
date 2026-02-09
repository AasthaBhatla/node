// controllers/ngoHelpRequestsController.js
const svc = require("../services/ngoHelpRequestsService");
const notify = require("../services/notify");
const userService = require("../services/userService");

function displayFirstName(userObj, fallback = "Someone") {
  const first =
    userObj?.metadata?.first_name ||
    userObj?.metadata?.name ||
    userObj?.metadata?.display_name ||
    "";
  const v = String(first).trim();
  return v || fallback;
}

function success(res, data, message = null) {
  return res.json({
    status: "success",
    body: message ? { message, data } : { data },
  });
}

function failure(res, message, statusCode = 400) {
  return res.status(statusCode).json({
    status: "failure",
    body: { message },
  });
}

// CLIENT: apply for help
async function apply(req, res) {
  const clientUserId = req.user.id;
  const ngoUserId = parseInt(req.params.ngoUserId, 10);

  if (!ngoUserId) return failure(res, "Invalid ngoUserId", 400);

  const r = await svc.createHelpRequest({
    clientUserId,
    ngoUserId,
    payload: req.body || {},
  });

  if (!r.ok) return failure(res, r.message, r.statusCode || 400);

  // This notifies the NGO about the Help Request
  try {
    const client = await userService.getUserById(clientUserId);
    const clientName = displayFirstName(client, "A client");
    await notify.user(
      ngoUserId,
      {
        title: "New Help Request",
        body: `${clientName} submitted a help request.`,
        data: {
          type: "ngo_help_request_created",
          ngo_help_request_id: r.data.id,
          client_user_id: clientUserId,
          ngo_user_id: ngoUserId,
        },
        push: true,
        store: true,
      },
      "ngo.help_request.created",
    );
  } catch (e) {
    // Don’t fail the API if notification fails
    console.error("Notify NGO failed:", e.message || e);
  }

  return success(res, r.data, "Help request submitted");
}

// CLIENT: list my requests
async function myList(req, res) {
  const clientUserId = req.user.id;
  const { status, page, limit } = req.query;

  const r = await svc.listMyHelpRequests(clientUserId, {
    status,
    page,
    limit,
  });

  if (!r.ok) return failure(res, r.message, 400);
  return success(res, r.data);
}

// CLIENT: get one of my requests
async function myGet(req, res) {
  const clientUserId = req.user.id;
  const requestId = parseInt(req.params.id, 10);
  if (!requestId) return failure(res, "Invalid request id", 400);

  const r = await svc.getMyHelpRequestById(clientUserId, requestId);
  if (!r.ok) return failure(res, r.message, 404);

  return success(res, r.data);
}

// CLIENT: withdraw
async function myWithdraw(req, res) {
  const clientUserId = req.user.id;
  const requestId = parseInt(req.params.id, 10);
  if (!requestId) return failure(res, "Invalid request id", 400);

  const r = await svc.withdrawHelpRequest({ clientUserId, requestId });
  if (!r.ok) return failure(res, r.message, r.statusCode || 400);

  return success(res, r.data, "Request withdrawn");
}

// NGO: list requests to me
async function ngoList(req, res) {
  const ngoUserId = req.user.id;
  const { status, page, limit } = req.query;

  const r = await svc.listNgoHelpRequests(ngoUserId, {
    status,
    page,
    limit,
  });

  if (!r.ok) return failure(res, r.message, 400);
  return success(res, r.data);
}

// NGO: get one request
async function ngoGet(req, res) {
  const ngoUserId = req.user.id;
  const requestId = parseInt(req.params.id, 10);
  if (!requestId) return failure(res, "Invalid request id", 400);

  const r = await svc.getNgoHelpRequestById(ngoUserId, requestId);
  if (!r.ok) return failure(res, r.message, 404);

  return success(res, r.data);
}

// NGO: accept/reject
async function ngoDecide(req, res) {
  const ngoUserId = req.user.id;
  const requestId = parseInt(req.params.id, 10);
  if (!requestId) return failure(res, "Invalid request id", 400);

  const { decision, note } = req.body || {};

  const r = await svc.decideHelpRequest({
    ngoUserId,
    requestId,
    decision,
    note,
  });

  if (!r.ok) return failure(res, r.message, r.statusCode || 400);

  // ✅ Notify the client who applied
  try {
    const status = r.data.status; // "accepted" or "rejected"
    const clientUserId = r.data.client_user_id;

    // fetch NGO profile to get first_name
    const ngo = await userService.getUserById(ngoUserId);
    const ngoName = displayFirstName(ngo, "The NGO");

    await notify.user(
      clientUserId,
      {
        title: "Help Request Update",
        body:
          status === "accepted"
            ? `${ngoName} accepted your help request.`
            : `${ngoName} rejected your help request.`,
        data: {
          type: "ngo_help_request_decided",
          ngo_help_request_id: r.data.id,
          decision: status,
          ngo_user_id: ngoUserId,
          note: r.data.ngo_decision_note || null,
        },
        push: true,
        store: true,
      },
      "ngo.help_request.decided",
    );
  } catch (e) {
    console.error("Notify client failed:", e.message || e);
  }

  return success(res, r.data, `Request ${r.data.status}`);
}

module.exports = {
  apply,
  myList,
  myGet,
  myWithdraw,
  ngoList,
  ngoGet,
  ngoDecide,
};
