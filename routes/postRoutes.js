const express = require("express");
const router = express.Router();
const postController = require("../controllers/postController");
const authMiddleware = require("../middlewares/authMiddleware");

router.use(authMiddleware);

router.get("/", postController.getPosts);
router.post("/filter", postController.getPosts);
router.get("/slug/:slug", postController.getPostBySlug);
router.get("/:id", postController.getPostById); 
router.post("/", postController.createPost);
router.post("/:id", postController.updatePost); 
router.delete("/metadata/:id", postController.deletePostMetadata);
router.delete("/:id", postController.deletePost);

module.exports = router;
