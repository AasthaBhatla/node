const {
  createServiceCheckout,
  generateFreeDocument,
  getServiceRequestByIdForAdmin,
  getServiceRequestByIdForUser,
  listServiceRequestsForUser,
  reportServiceRequests,
  updateServiceRequestStatus,
} = require("../services/serviceRequestService");

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

exports.checkout = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await createServiceCheckout(Number(req.user.id), req.body || {});
    return res.status(201).json(result);
  } catch (error) {
    return handleError(res, error, "Create Service Checkout Error:");
  }
};

exports.generateFreeDocument = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await generateFreeDocument(Number(req.user.id), req.body || {});
    return res.status(201).json(result);
  } catch (error) {
    return handleError(res, error, "Generate Free Document Error:");
  }
};

exports.listMine = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await listServiceRequestsForUser(Number(req.user.id));
    return res.status(200).json(result);
  } catch (error) {
    return handleError(res, error, "List My Service Requests Error:");
  }
};

exports.getMineById = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const request = await getServiceRequestByIdForUser(
      Number(req.params.id),
      Number(req.user.id),
    );
    if (!request) {
      return res.status(404).json({ error: "Service request not found" });
    }

    return res.status(200).json(request);
  } catch (error) {
    return handleError(res, error, "Get My Service Request Error:");
  }
};

exports.report = async (req, res) => {
  try {
    const report = await reportServiceRequests(req.body || {});
    return res.status(200).json(report);
  } catch (error) {
    return handleError(res, error, "Service Request Report Error:");
  }
};

exports.getById = async (req, res) => {
  try {
    const request = await getServiceRequestByIdForAdmin(Number(req.params.id));
    if (!request) {
      return res.status(404).json({ error: "Service request not found" });
    }

    return res.status(200).json(request);
  } catch (error) {
    return handleError(res, error, "Get Service Request Error:");
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const request = await updateServiceRequestStatus(
      Number(req.params.id),
      req.body?.status,
    );
    if (!request) {
      return res.status(404).json({ error: "Service request not found" });
    }

    return res.status(200).json(request);
  } catch (error) {
    return handleError(res, error, "Update Service Request Status Error:");
  }
};
