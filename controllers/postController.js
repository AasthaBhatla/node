const {
  createPost,
  createPostMetadata,
  getPostById,
  getPostBySlug,
  getAllPosts,
  getMetadataByPostId,
  updatePostById,
  updatePostMetadata,
  upsertPostMetadata,
  deletePostById,
  deletePostMetadataById,
} = require("../services/postService");

exports.createPost = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can create posts" });
    }

    const { post_type, title, slug, metadata } = req.body;
    if (!post_type || !title || !slug) {
      return res
        .status(400)
        .json({ error: "post_type, title, and slug are required" });
    }

    const post = await createPost(post_type, title, slug, req.user.id);

    if (metadata && typeof metadata === "object") {
      for (const key of Object.keys(metadata)) {
        await createPostMetadata(post.id, key, metadata[key]);
      }
    }

    return res.status(201).json({ message: "Post created successfully", post });
  } catch (err) {
    console.error("Create Post Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.getPosts = async (req, res) => {
  try {
    const posts = await getAllPosts();
    return res.json({ posts });
  } catch (err) {
    console.error("Get Posts Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.getPostById = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await getPostById(id);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const metadata = await getMetadataByPostId(id);
    return res.json({ post, metadata });
  } catch (err) {
    console.error("Get Post By ID Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.getPostBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await getPostBySlug(slug);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const metadata = await getMetadataByPostId(post.id);
    return res.json({ post, metadata });
  } catch (err) {
    console.error("Get Post By Slug Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.updatePost = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can update posts" });
    }

    const { id } = req.params;
    const { post_type, title, slug, metadata } = req.body;

    const updatedPost = await updatePostById(id, post_type, title, slug);
    if (!updatedPost) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (metadata && typeof metadata === "object") {
      for (const key of Object.keys(metadata)) {
        await updatePostMetadata(id, key, metadata[key]);
      }
    }

    return res.json({ message: "Post updated successfully", updatedPost });
  } catch (err) {
    console.error("Update Post Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.deletePost = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can delete posts" });
    }

    const { id } = req.params;
    const deletedPost = await deletePostById(id);
    if (!deletedPost) {
      return res.status(404).json({ error: "Post not found" });
    }

    return res.json({ message: "Post deleted successfully" });
  } catch (err) {
    console.error("Delete Post Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.deletePostMetadata = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can delete metadata" });
    }

    const { id } = req.params;
    const deletedMeta = await deletePostMetadataById(id);
    if (!deletedMeta) {
      return res.status(404).json({ error: "Post metadata not found" });
    }

    return res.json({ message: "Post metadata deleted successfully" });
  } catch (err) {
    console.error("Delete Metadata Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
exports.getMetadataByPostId = async (req, res) => {
  try {
    const { id } = req.params;
    const metadata = await getMetadataByPostId(id);

    if (!metadata || metadata.length === 0) {
      return res.status(404).json({ error: "No metadata found for this post" });
    }

    return res.json({ metadata });
  } catch (err) {
    console.error("Get Metadata Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.createPostMetadata = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can add metadata" });
    }

    const { id } = req.params;
    const { key, value } = req.body;

    if (!key || !value) {
      return res.status(400).json({ error: "Both key and value are required" });
    }

    const meta = await createPostMetadata(id, key, value);
    return res
      .status(201)
      .json({ message: "Metadata created successfully", meta });
  } catch (err) {
    console.error("Create Metadata Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.updatePostMetadata = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can update metadata" });
    }

    const { id } = req.params;
    const { key, value } = req.body;

    if (!key || !value) {
      return res.status(400).json({ error: "Both key and value are required" });
    }

    const updatedMeta = await updatePostMetadata(id, key, value);
    if (!updatedMeta) {
      return res.status(404).json({ error: "Metadata not found" });
    }

    return res.json({ message: "Metadata updated successfully", updatedMeta });
  } catch (err) {
    console.error("Update Metadata Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.upsertPostMetadata = async (req, res) => {
  return res.status(200).json({ message: "A Test Message" });
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can upsert metadata" });
    }
    const { id: postId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Provide { items: [...] }" });
    }

    const results = [];
    for (const i of items) {
      if (!i.key || typeof i.value === "undefined") {
        return res
          .status(400)
          .json({ error: "Each item must have key and value" });
      }
      const meta = await upsertPostMetadata(postId, i.key, i.value);
      results.push(meta);
    }

    return res
      .status(200)
      .json({ message: "Metadata upserted", items: results });
  } catch (err) {
    console.error("Upsert Metadata Error:", err.stack || err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
