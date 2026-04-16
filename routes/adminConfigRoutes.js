const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/requireAdmin");
const adminConfigController = require("../controllers/adminConfigController");

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  requireAdmin(),
  adminConfigController.getConfig,
);

router.post(
  "/import",
  authMiddleware,
  requireAdmin(),
  adminConfigController.importConfig,
);

router.put(
  "/post-types",
  authMiddleware,
  requireAdmin(),
  adminConfigController.putPostType,
);

router.delete(
  "/post-types/:slug",
  authMiddleware,
  requireAdmin(),
  adminConfigController.deletePostType,
);

router.put(
  "/post-types/:slug/meta-keys",
  authMiddleware,
  requireAdmin(),
  adminConfigController.putPostTypeMeta,
);

router.put(
  "/taxonomies",
  authMiddleware,
  requireAdmin(),
  adminConfigController.putTaxonomy,
);

router.put(
  "/taxonomies/:id/meta-keys",
  authMiddleware,
  requireAdmin(),
  adminConfigController.putTaxonomyMeta,
);

router.put(
  "/users/settings",
  authMiddleware,
  requireAdmin(),
  adminConfigController.putUsersSettings,
);

router.put(
  "/reviews/settings",
  authMiddleware,
  requireAdmin(),
  adminConfigController.putReviewsSettings,
);

module.exports = router;
