const express = require("express");
const path = require("path");
const { PORT } = require("./src/config");
const apiRouter = require("./src/routes");

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use("/api", apiRouter);
app.use(express.static(path.join(__dirname, "public")));

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Claude Code Lens listening on http://localhost:${PORT}`);
});
