const express = require("express");
const sessionsRouter = require("./sessions");
const filesRouter = require("./files");
const commentsRouter = require("./comments");
const exportRouter = require("./export");

const router = express.Router();

router.use("/", sessionsRouter);
router.use("/", filesRouter);
router.use("/", commentsRouter);
router.use("/", exportRouter);

module.exports = router;
