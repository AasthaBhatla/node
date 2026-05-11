const {
  addVersion,
  listForAdmin,
  listForUser,
  updateDocumentStatusById,
  updateDocumentStatusForServiceRequest,
  normalizeStatus,
} = require("../services/profileDocumentService");

function handleError(res, error, fallbackMessage) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      details: error.details || null,
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({ error: "Internal server error" });
}

exports.listMine = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const result = await listForUser(Number(req.user.id));
    return res.status(200).json(result);
  } catch (error) {
    return handleError(res, error, "List Profile Documents Error:");
  }
};

exports.listAdmin = async (req, res) => {
  try {
    const result = await listForAdmin({
      search: req.query.search,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.status(200).json(result);
  } catch (error) {
    return handleError(res, error, "Admin List Profile Documents Error:");
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const status = normalizeStatus(req.body?.status);
    const serviceRequestId = Number(req.body?.service_request_id || req.body?.serviceRequestId);
    const document = serviceRequestId
      ? await updateDocumentStatusForServiceRequest(
          serviceRequestId,
          status,
          req.user?.id ? Number(req.user.id) : null,
        )
      : await updateDocumentStatusById(
          Number(req.params.id),
          status,
          req.user?.id ? Number(req.user.id) : null,
        );
    if (!document) {
      return res.status(404).json({ error: "Profile document not found" });
    }
    return res.status(200).json({ document });
  } catch (error) {
    return handleError(res, error, "Admin Update Profile Document Status Error:");
  }
};

exports.addVersion = async (req, res) => {
  try {
    const document = await addVersion(
      Number(req.params.id),
      req.body || {},
      req.user?.id ? Number(req.user.id) : null,
    );
    return res.status(201).json(document);
  } catch (error) {
    return handleError(res, error, "Admin Add Profile Document Version Error:");
  }
};
