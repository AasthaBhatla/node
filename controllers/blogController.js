const {
  createBlog,
  deleteBlog,
  getBlogById,
  getPublicBlogBySlug,
  listPublicBlogFilters,
  listPublicBlogs,
  reportBlogs,
  updateBlog,
} = require("../services/blogService");

function handleError(res, error, fallbackMessage) {
  if (error?.code === "23505") {
    return res.status(409).json({
      error: "A blog with this slug already exists",
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
    const record = await createBlog(req.body, req.user);
    return res.status(201).json(record);
  } catch (error) {
    return handleError(res, error, "Create Blog Error:");
  }
};

exports.update = async (req, res) => {
  try {
    const updated = await updateBlog(Number(req.params.id), req.body, req.user);
    if (!updated) {
      return res.status(404).json({ error: "Blog not found" });
    }

    return res.status(200).json(updated);
  } catch (error) {
    return handleError(res, error, "Update Blog Error:");
  }
};

exports.getById = async (req, res) => {
  try {
    const record = await getBlogById(Number(req.params.id));
    if (!record) {
      return res.status(404).json({ error: "Blog not found" });
    }

    return res.status(200).json(record);
  } catch (error) {
    return handleError(res, error, "Get Blog By ID Error:");
  }
};

exports.remove = async (req, res) => {
  try {
    const deleted = await deleteBlog(Number(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: "Blog not found" });
    }

    return res.status(200).json({
      message: "Blog deleted successfully",
      deleted,
    });
  } catch (error) {
    return handleError(res, error, "Delete Blog Error:");
  }
};

exports.report = async (req, res) => {
  try {
    const report = await reportBlogs(req.body || {});
    return res.status(200).json(report);
  } catch (error) {
    return handleError(res, error, "Blog Report Error:");
  }
};

exports.publicList = async (req, res) => {
  try {
    const list = await listPublicBlogs(req.query || {});
    return res.status(200).json(list);
  } catch (error) {
    return handleError(res, error, "Public Blog List Error:");
  }
};

exports.publicFilters = async (_req, res) => {
  try {
    const filters = await listPublicBlogFilters();
    return res.status(200).json(filters);
  } catch (error) {
    return handleError(res, error, "Public Blog Filters Error:");
  }
};

exports.publicBySlug = async (req, res) => {
  try {
    const record = await getPublicBlogBySlug(req.params.slug);
    if (!record) {
      return res.status(404).json({ error: "Published blog not found" });
    }

    return res.status(200).json(record);
  } catch (error) {
    return handleError(res, error, "Public Blog Lookup Error:");
  }
};
