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
    const requestType = String(req.body?.request_type || "chat")
      .toLowerCase()
      .trim();

    const out = await expertConnectService.requestConnection(
      req.user.id,
      requestType,
    );

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
    const actorId = req.user?.id;
    const actorRole = req.user?.role;

    const requestId = parseId(req.params.id, "id");

    const sessionIdRaw = req.body?.session_id;
    const sessionId = sessionIdRaw == null ? null : parseInt(sessionIdRaw, 10);

    const request = await expertConnectService.markConnected({
      requestId,
      actorId,
      actorRole,
      sessionId:
        sessionId == null || Number.isNaN(sessionId) ? null : sessionId,
    });

    return res.status(200).json({ request });
  } catch (err) {
    return handleError(res, err, "Mark connected error:");
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

exports.getMyActiveRequest = async (req, res) => {
  try {
    const out = await expertConnectService.getMyActiveRequest({
      userId: req.user.id,
      role: req.user.role,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Get my active expert-connect request error:");
  }
};

exports.getMyOffers = async (req, res) => {
  try {
    const out = await expertConnectService.getMyOffers({
      expertId: req.user.id,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Get my expert offers error:");
  }
};

function parseYmdDate(value, fieldName) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error(`${fieldName} must be YYYY-MM-DD`);
    err.statusCode = 400;
    throw err;
  }
  return s;
}

function parsePageLimit(q) {
  const page = Math.max(1, parseInt(q.page || "1", 10));
  const limitRaw = parseInt(q.limit || "20", 10);
  const limit = Math.min(100, Math.max(1, limitRaw));
  return { page, limit, offset: (page - 1) * limit };
}

function parseOptionalId(value, fieldName) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    const err = new Error(`${fieldName} must be a positive integer`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

exports.listMyClientSessions = async (req, res) => {
  try {
    const { page, limit, offset } = parsePageLimit(req.query);
    const from = parseYmdDate(req.query.from, "from");
    const to = parseYmdDate(req.query.to, "to");

    const out = await expertConnectService.listSessionsForClient({
      clientId: req.user.id,
      page,
      limit,
      offset,
      from,
      to,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "List client sessions error:");
  }
};

exports.listMyExpertSessions = async (req, res) => {
  try {
    const { page, limit, offset } = parsePageLimit(req.query);
    const from = parseYmdDate(req.query.from, "from");
    const to = parseYmdDate(req.query.to, "to");

    const out = await expertConnectService.listSessionsForExpert({
      expertId: req.user.id,
      page,
      limit,
      offset,
      from,
      to,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "List expert sessions error:");
  }
};

exports.adminListSessions = async (req, res) => {
  try {
    const { page, limit, offset } = parsePageLimit(req.query);
    const from = parseYmdDate(req.query.from, "from");
    const to = parseYmdDate(req.query.to, "to");

    const expertId = parseOptionalId(req.query.expert_id, "expert_id");
    const clientId = parseOptionalId(req.query.client_id, "client_id");

    const out = await expertConnectService.listSessionsForAdmin({
      page,
      limit,
      offset,
      from,
      to,
      expertId,
      clientId,
    });

    return res.status(200).json(out);
  } catch (err) {
    return handleError(res, err, "Admin list sessions error:");
  }
};

exports.linkSession = async (req, res) => {
  try {
    const actorId = req.user?.id;
    const actorRole = req.user?.role;

    const requestId = parseInt(req.params.request_id, 10);
    const sessionId = parseInt(req.body?.session_id, 10);

    const data = await expertConnectService.linkWalletSessionToRequest({
      requestId,
      sessionId,
      actorId,
      actorRole,
    });

    return success(res, data);
  } catch (err) {
    return failure(res, err.message || "Error", err.statusCode || 400);
  }
};
