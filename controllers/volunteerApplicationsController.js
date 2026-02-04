// controllers/volunteerApplicationsController.js
const svc = require("../services/volunteerApplicationsService");

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

// CLIENT: apply to NGO
async function apply(req, res) {
  const applicantUserId = req.user.id;
  const ngoUserId = parseInt(req.params.ngoUserId, 10);

  if (!ngoUserId) return failure(res, "Invalid ngoUserId", 400);

  const r = await svc.createApplication({
    applicantUserId,
    ngoUserId,
    payload: req.body || {},
  });

  if (!r.ok) return failure(res, r.message, 400);
  return success(res, r.data, "Application submitted");
}

// CLIENT: list my applications
async function myList(req, res) {
  const applicantUserId = req.user.id;
  const { status, page, limit } = req.query;

  const r = await svc.listMyApplications(applicantUserId, {
    status,
    page,
    limit,
  });

  if (!r.ok) return failure(res, r.message, 400);
  return success(res, r.data);
}

// CLIENT: get one application (mine)
async function myGet(req, res) {
  const applicantUserId = req.user.id;
  const applicationId = parseInt(req.params.id, 10);
  if (!applicationId) return failure(res, "Invalid application id", 400);

  const r = await svc.getMyApplicationById(applicantUserId, applicationId);
  if (!r.ok) return failure(res, r.message, 404);

  return success(res, r.data);
}

// NGO: list applications to me
async function ngoList(req, res) {
  const ngoUserId = req.user.id;
  const { status, page, limit } = req.query;

  const r = await svc.listNgoApplications(ngoUserId, {
    status,
    page,
    limit,
  });

  if (!r.ok) return failure(res, r.message, 400);
  return success(res, r.data);
}

// NGO: get one application (to me)
async function ngoGet(req, res) {
  const ngoUserId = req.user.id;
  const applicationId = parseInt(req.params.id, 10);
  if (!applicationId) return failure(res, "Invalid application id", 400);

  const r = await svc.getNgoApplicationById(ngoUserId, applicationId);
  if (!r.ok) return failure(res, r.message, 404);

  return success(res, r.data);
}

// NGO: accept/reject
async function ngoDecide(req, res) {
  const ngoUserId = req.user.id;
  const applicationId = parseInt(req.params.id, 10);
  if (!applicationId) return failure(res, "Invalid application id", 400);

  const { decision, note } = req.body || {};

  const r = await svc.decideApplication({
    ngoUserId,
    applicationId,
    decision,
    note,
  });

  if (!r.ok) return failure(res, r.message, 400);
  return success(res, r.data, `Application ${r.data.status}`);
}

module.exports = {
  apply,
  myList,
  myGet,
  ngoList,
  ngoGet,
  ngoDecide,
};
