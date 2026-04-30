const {
  createService,
  deleteService,
  getPublicServiceBySlug,
  getServiceById,
  getServiceReportSummary,
  listPublicServiceFilters,
  listPublicServices,
  reportServices,
  updateService,
} = require("../services/serviceService");

function handleError(res, error, fallbackMessage) {
  if (error?.code === "23505") {
    return res.status(409).json({
      error: "A service with this slug already exists",
      detail: error.detail || null,
    });
  }

  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      details: error.details || null,
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({ error: "Internal server error" });
}

exports.create = async (req, res) => {
  try {
    const record = await createService(req.body, req.user);
    return res.status(201).json(record);
  } catch (error) {
    return handleError(res, error, "Create Service Error:");
  }
};

exports.update = async (req, res) => {
  try {
    const updated = await updateService(Number(req.params.id), req.body, req.user);
    if (!updated) {
      return res.status(404).json({ error: "Service not found" });
    }

    return res.status(200).json(updated);
  } catch (error) {
    return handleError(res, error, "Update Service Error:");
  }
};

exports.getById = async (req, res) => {
  try {
    const record = await getServiceById(Number(req.params.id));
    if (!record) {
      return res.status(404).json({ error: "Service not found" });
    }

    return res.status(200).json(record);
  } catch (error) {
    return handleError(res, error, "Get Service By ID Error:");
  }
};

exports.remove = async (req, res) => {
  try {
    const deleted = await deleteService(Number(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: "Service not found" });
    }

    return res.status(200).json({
      message: "Service deleted successfully",
      deleted,
    });
  } catch (error) {
    return handleError(res, error, "Delete Service Error:");
  }
};

exports.report = async (req, res) => {
  try {
    const report = await reportServices(req.body || {});
    return res.status(200).json(report);
  } catch (error) {
    return handleError(res, error, "Service Report Error:");
  }
};

exports.summary = async (req, res) => {
  try {
    const summary = await getServiceReportSummary(req.body || {});
    return res.status(200).json(summary);
  } catch (error) {
    return handleError(res, error, "Service Summary Error:");
  }
};

exports.publicList = async (req, res) => {
  try {
    const list = await listPublicServices(req.query || {});
    return res.status(200).json(list);
  } catch (error) {
    return handleError(res, error, "Public Service List Error:");
  }
};

exports.publicFilters = async (_req, res) => {
  try {
    const filters = await listPublicServiceFilters();
    return res.status(200).json(filters);
  } catch (error) {
    return handleError(res, error, "Public Service Filters Error:");
  }
};

exports.publicBySlug = async (req, res) => {
  try {
    const record = await getPublicServiceBySlug(req.params.slug);
    if (!record) {
      return res.status(404).json({ error: "Published service not found" });
    }

    return res.status(200).json(record);
  } catch (error) {
    return handleError(res, error, "Public Service Lookup Error:");
  }
};
