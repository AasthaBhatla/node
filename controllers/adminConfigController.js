const {
  deletePostType,
  getAdminConfig,
  importAdminConfig,
  savePostType,
  savePostTypeMeta,
  saveReviewsSettings,
  saveTaxonomy,
  saveTaxonomyMeta,
  saveUsersSettings,
} = require("../services/adminConfigService");

function failure(res, statusCode, message) {
  return res.status(statusCode).json({
    status: "failure",
    body: { message },
  });
}

exports.getConfig = async (req, res) => {
  try {
    const data = await getAdminConfig();
    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};

exports.importConfig = async (req, res) => {
  try {
    const data = await importAdminConfig(req.body || {}, req.user);
    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};

exports.putPostType = async (req, res) => {
  try {
    const data = await savePostType({
      title: req.body?.title,
      slug: req.body?.slug,
      previousSlug: req.body?.previousSlug,
      adminUser: req.user,
    });

    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};

exports.deletePostType = async (req, res) => {
  try {
    const data = await deletePostType(req.params.slug, req.user);
    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};

exports.putPostTypeMeta = async (req, res) => {
  try {
    const data = await savePostTypeMeta(
      req.params.slug,
      req.body?.meta_keys,
      req.user,
    );
    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};

exports.putTaxonomy = async (req, res) => {
  try {
    const data = await saveTaxonomy(req.body || {}, req.user);
    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};

exports.putTaxonomyMeta = async (req, res) => {
  try {
    const data = await saveTaxonomyMeta(
      req.params.id,
      req.body?.meta_keys,
      req.user,
    );
    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};

exports.putUsersSettings = async (req, res) => {
  try {
    const data = await saveUsersSettings(req.body || {}, req.user);
    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};

exports.putReviewsSettings = async (req, res) => {
  try {
    const data = await saveReviewsSettings(req.body || {}, req.user);
    return res.status(200).json({
      status: "success",
      body: data,
    });
  } catch (error) {
    return failure(
      res,
      error.statusCode || 500,
      error.message || "Internal server error",
    );
  }
};
