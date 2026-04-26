const express = require("express");
const router = express.Router();
const { searchBuses } = require("../controllers/busController");

router.get("/search", searchBuses);

module.exports = router;