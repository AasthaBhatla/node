const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");

router.post("/", orderController.create);
router.get("/", orderController.getAll);
router.get("/:id", orderController.getById);
router.post("/:id", orderController.updateById);
router.delete("/:id", orderController.deleteById);

module.exports = router;
