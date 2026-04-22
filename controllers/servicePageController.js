const {
  createServicePage,
  deleteServicePage,
  getPublicServicePageBySlug,
  getServicePageById,
  getServicePageReportSummary,
  listPublicServicePages,
  reportServicePages,
  updateServicePage,
} = require("../services/servicePageService");

function handleError(res, error, fallbackMessage) {
  if (error?.code === "23505") {
    return res.status(409).json({
      error: "A translation with this locale and slug already exists",
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
    const record = await createServicePage(req.body, req.user);
    return res.status(201).json(record);
  } catch (error) {
    return handleError(res, error, "Create Service Page Error:");
  }
};

exports.update = async (req, res) => {
  try {
    const updated = await updateServicePage(Number(req.params.id), req.body);
    if (!updated) {
      return res.status(404).json({ error: "Service page not found" });
    }

    return res.status(200).json(updated);
  } catch (error) {
    return handleError(res, error, "Update Service Page Error:");
  }
};

exports.getById = async (req, res) => {
  try {
    const record = await getServicePageById(Number(req.params.id));
    if (!record) {
      return res.status(404).json({ error: "Service page not found" });
    }

    return res.status(200).json(record);
  } catch (error) {
    return handleError(res, error, "Get Service Page By ID Error:");
  }
};

exports.remove = async (req, res) => {
  try {
    const deleted = await deleteServicePage(Number(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: "Service page not found" });
    }

    return res.status(200).json({
      message: "Service page deleted successfully",
      deleted,
    });
  } catch (error) {
    return handleError(res, error, "Delete Service Page Error:");
  }
};

exports.report = async (req, res) => {
  try {
    const report = await reportServicePages(req.body || {});
    return res.status(200).json(report);
  } catch (error) {
    return handleError(res, error, "Service Page Report Error:");
  }
};

exports.summary = async (req, res) => {
  try {
    const summary = await getServicePageReportSummary(req.body || {});
    return res.status(200).json(summary);
  } catch (error) {
    return handleError(res, error, "Service Page Summary Error:");
  }
};

exports.publicList = async (req, res) => {
  try {
    const list = await listPublicServicePages(req.query || {});
    return res.status(200).json(list);
  } catch (error) {
    return handleError(res, error, "Public Service Page List Error:");
  }
};

exports.publicBySlug = async (req, res) => {
  try {
    const record = await getPublicServicePageBySlug(req.params.locale, req.params.slug);
    if (!record) {
      return res.status(404).json({ error: "Published service page not found" });
    }

    return res.status(200).json(record);
  } catch (error) {
    return handleError(res, error, "Public Service Page Lookup Error:");
  }
};
