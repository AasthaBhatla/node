// controllers/expertConnectController.js
const expertConnectService = require("../services/expertConnectService");

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    const err = new Error(`${fieldName} must be a positive integer`);
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

function handleError(res, err, fallbackMessage) {
  console.error(fallbackMessage, err);
  return res.status(err.statusCode || 500).json({
    error: err.message || "Server error",
  });
}

exports.createConnectionRequest = async (req, res) => {
  try {
    const out = await expertConnectService.requestConnection(req.user.id);
    return res.status(out.is_existing ? 200 : 201).json(out);
  } catch (err) {
    return handleError(res, err, "Create expert connection request error:");
  }
};

exports.getRequestStatus = async (req, res) => {
  try {
    const requestId = parseId(req.params.id, "id");

    const out = await expertConnectService.getRequestStatus({
      requestId,
      actorId: req.user.id,
      actorRole: req.user.role,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Get expert connection request status error:");
  }
};

exports.cancelRequest = async (req, res) => {
  try {
    const requestId = parseId(req.params.id, "id");

    const out = await expertConnectService.cancelRequest({
      requestId,
      actorId: req.user.id,
      actorRole: req.user.role,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Cancel expert connection request error:");
  }
};

exports.updateMyOnlineStatus = async (req, res) => {
  try {
    const { is_online, max_concurrent_clients } = req.body;

    if (typeof is_online !== "boolean") {
      return res.status(400).json({
        error: "is_online is required and must be boolean",
      });
    }

    const out = await expertConnectService.setExpertOnlineStatus({
      expertId: req.user.id,
      isOnline: is_online,
      maxConcurrentClients: max_concurrent_clients,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Update expert online status error:");
  }
};

exports.markConnected = async (req, res) => {
  try {
    const requestId = parseId(req.params.id, "id");

    const out = await expertConnectService.markConnected({
      requestId,
      actorId: req.user.id,
      actorRole: req.user.role,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Mark expert connection as connected error:");
  }
};

exports.markCompleted = async (req, res) => {
  try {
    const requestId = parseId(req.params.id, "id");

    const out = await expertConnectService.completeRequest({
      requestId,
      actorId: req.user.id,
      actorRole: req.user.role,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Mark expert connection as completed error:");
  }
};

exports.getQueueOverview = async (req, res) => {
  try {
    const out = await expertConnectService.getQueueOverview();
    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Get expert queue overview error:");
  }
};

exports.getMyOffers = async (req, res) => {
  try {
    const out = await expertConnectService.getMyOffers({
      expertId: req.user.id,
    });
    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Get expert offers error:");
  }
};

exports.acceptOffer = async (req, res) => {
  try {
    const requestId = parseId(req.params.id, "id");
    const out = await expertConnectService.acceptOffer({
      requestId,
      expertId: req.user.id,
    });
    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Accept offer error:");
  }
};

exports.rejectOffer = async (req, res) => {
  try {
    const requestId = parseId(req.params.id, "id");
    const { reason } = req.body || {};
    const out = await expertConnectService.rejectOffer({
      requestId,
      expertId: req.user.id,
      reason,
    });
    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Reject offer error:");
  }
};
