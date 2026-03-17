const os = require("os");
const path = require("path");

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

const PORT = Number(process.env.PORT || 3456);
const PROJECTS_PATH = process.env.PROJECTS_PATH || "~/.claude/projects";
const UPLOAD_PATH = process.env.UPLOAD_PATH || path.join(os.tmpdir(), "claude-code-lens-uploads");

module.exports = {
  PORT,
  PROJECTS_PATH,
  UPLOAD_PATH,
  expandHome,
};
