const {
  createPost,
  getPostById,
  getPostBySlug,
  getAllPosts,
  getMetadataByPostId,
  updatePostById,
  upsertPostMetadata,
  deletePostById,
  deletePostMetadataById,
  addTermToPost,
  removeTermsFromPost
} = require("../services/postService");

exports.createPost = async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Only admin can create posts" });

    const { post_type, title, slug, metadata, term_ids } = req.body;
    if (!title || !slug) return res.status(400).json({ error: "title and slug are required" });

    const post = await createPost(post_type, title, slug, req.user.id);

    if (metadata && typeof metadata === "object") {
      for (const key of Object.keys(metadata)) await upsertPostMetadata(post.id, key, metadata[key]);
    }

    if (Array.isArray(term_ids)) {
      for (const termId of term_ids) await addTermToPost(post.id, termId);
    }

    const postMetadata = await getMetadataByPostId(post.id);

    return res.status(201).json({ message: "Post created successfully", post, metadata: postMetadata });
  } catch (err) {
    console.error("Create Post Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.updatePost = async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Only admin can update posts" });

    const { id } = req.params;
    const { post_type, title, slug, metadata, term_ids } = req.body;

    const updatedPost = await updatePostById(id, post_type, title, slug);
    if (!updatedPost) return res.status(404).json({ error: "Post not found" });

    if (metadata && typeof metadata === "object") {
      for (const key of Object.keys(metadata)) await upsertPostMetadata(id, key, metadata[key]);
    }

    if (Array.isArray(term_ids)) {
      await removeTermsFromPost(id);
      for (const termId of term_ids) await addTermToPost(id, termId);
    }

    const postMetadata = await getMetadataByPostId(id);

    return res.json({ message: "Post updated successfully", updatedPost, metadata: postMetadata });
  } catch (err) {
    console.error("Update Post Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.upsertPostMetadata = async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Only admin can upsert metadata" });

    const { id: postId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Provide { items: [...] }" });

    for (const i of items) {
      if (!i.key || typeof i.value === "undefined") return res.status(400).json({ error: "Each item must have key and value" });
      await upsertPostMetadata(postId, i.key, i.value);
    }

    const postMetadata = await getMetadataByPostId(postId);

    return res.status(200).json({ message: "Metadata upserted successfully", metadata: postMetadata });
  } catch (err) {
    console.error("Upsert Metadata Error:", err.stack || err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.getPostId = async (req, res) => {
  try {
    const post = await getPostById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const metadata = await getMetadataByPostId(post.id);
    return res.json({ post, metadata });
  } catch (err) {
    console.error("Get Post By ID Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.getPostBySlug = async (req, res) => {
  try {
    const post = await getPostBySlug(req.params.slug);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const metadata = await getMetadataByPostId(post.id);
    return res.json({ post, metadata });
  } catch (err) {
    console.error("Get Post By Slug Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.getPosts = async (req, res) => {
  try {
    const { offset, limit, post_type, term_ids, metadata } = req.body;
    const posts = await getAllPosts(
      parseInt(offset, 10) || 0,
      parseInt(limit, 10) || 10,
      post_type || "post",
      Array.isArray(term_ids) ? term_ids.map(Number).filter(Boolean) : [],
      typeof metadata === "object" && metadata !== null ? metadata : {}
    );
    return res.json({ posts });
  } catch (err) {
    console.error("Get Posts Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.deletePost = async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Only admin can delete posts" });

    const deletedPost = await deletePostById(req.params.id);
    if (!deletedPost) return res.status(404).json({ error: "Post not found" });

    return res.json({ message: "Post deleted successfully" });
  } catch (err) {
    console.error("Delete Post Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.deletePostMetadata = async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Only admin can delete metadata" });

    const deletedMeta = await deletePostMetadataById(req.params.id);
    if (!deletedMeta) return res.status(404).json({ error: "Post metadata not found" });

    return res.json({ message: "Post metadata deleted successfully" });
  } catch (err) {
    console.error("Delete Metadata Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
