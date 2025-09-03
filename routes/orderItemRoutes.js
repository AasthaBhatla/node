const express = require("express");
const router = express.Router();
const orderItemController = require("../controllers/orderItemController");

router.post("/", orderItemController.create);
router.get("/", orderItemController.getAll);
router.get("/:id", orderItemController.getById);
router.post("/:id", orderItemController.updateById);
router.delete("/:id", orderItemController.deleteById);

module.exports = router;
