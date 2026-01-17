const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const getUpload = require("../middlewares/upload");
const userController = require("../controllers/userController");

const uploadProfile = getUpload("profile");
const uploadDocument = getUpload("document");

router.post("/by-ids", authMiddleware, userController.getUsersByIds);
router.post("/by-terms", userController.getUsersByTerms);
router.get("/me", authMiddleware, userController.getMe);
router.get("/search", authMiddleware, userController.searchUsers);
router.post("/find", userController.findUsersPublic);
router.post("/me", authMiddleware, userController.updateMe);
router.post("/", userController.getUsers);
router.get("/:id", authMiddleware, userController.getUserById);
router.post("/:id", authMiddleware, userController.updateUserMetaByAdmin);

router.post(
  "/profile-picture",
  authMiddleware,
  uploadProfile.single("image"),
  userController.uploadProfilePic
);
router.post(
  "/documents",
  authMiddleware,
  uploadDocument.single("document"),
  userController.uploadDocument
);
router.delete("/document/:id", authMiddleware, userController.deleteDocument);
router.get("/documents/:id", authMiddleware, userController.listUserDocuments);
router.delete("/:id", authMiddleware, userController.deleteUser);

module.exports = router;
