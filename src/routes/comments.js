const express = require("express");
const commentsDb = require("../db/commentsDb");

const router = express.Router();

router.post("/comments", (req, res) => {
  try {
    const nodeId = req.body?.nodeId;
    const comment = req.body?.comment ?? "";

    if (!nodeId || typeof nodeId !== "string") {
      res.status(400).json({ error: "nodeId is required" });
      return;
    }

    commentsDb.upsert(nodeId, String(comment));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to save comment", details: error.message });
  }
});

module.exports = router;
