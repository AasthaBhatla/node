const express = require("express");
const router = express.Router();
const postController = require("../controllers/postController");
const authMiddleware = require("../middlewares/authMiddleware");

router.use(authMiddleware);

router.get("/", postController.getPosts);
router.get("/slug/:slug", postController.getPostBySlug);
router.get("/:id/metadata", postController.getMetadataByPostId);
router.get("/:id", postController.getPostById);

router.post("/", postController.createPost);
// router.post("/:id/metadata", postController.createPostMetadata);
router.post("/:id/metadata", postController.upsertPostMetadata);
router.post("/:id", postController.updatePost);
// router.post("/metadata/:id", postController.updatePostMetadata);

router.delete("/:id", postController.deletePost);
router.delete("/metadata/:id", postController.deletePostMetadata);

module.exports = router;
