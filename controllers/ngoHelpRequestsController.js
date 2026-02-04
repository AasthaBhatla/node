// controllers/ngoHelpRequestsController.js
const svc = require("../services/ngoHelpRequestsService");

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
