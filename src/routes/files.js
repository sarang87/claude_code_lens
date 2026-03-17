const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { UPLOAD_PATH, expandHome } = require("../config");

const router = express.Router();

router.get("/file", (req, res) => {
  try {
    const inputPath = req.query.path;
    if (!inputPath || typeof inputPath !== "string") {
      res.status(400).json({ error: "path query parameter is required" });
      return;
    }

    const expanded = path.resolve(expandHome(inputPath));
    if (!path.isAbsolute(expanded) || !fs.existsSync(expanded)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.sendFile(expanded);
  } catch (error) {
    res.status(500).json({ error: "Failed to load file", details: error.message });
  }
});

router.post(
  "/upload-jsonl",
  express.raw({ type: "application/octet-stream", limit: "50mb" }),
  (req, res) => {
    try {
      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "Missing JSONL file bytes in request body" });
        return;
      }

      fs.mkdirSync(UPLOAD_PATH, { recursive: true });
      const fileName = `upload_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.jsonl`;
      const targetPath = path.join(UPLOAD_PATH, fileName);
      fs.writeFileSync(targetPath, req.body);

      res.json({ success: true, path: targetPath });
    } catch (error) {
      res.status(500).json({ error: "Failed to upload JSONL", details: error.message });
    }
  },
);

module.exports = router;
