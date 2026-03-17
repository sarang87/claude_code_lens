const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(process.cwd(), "comments.sqlite");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    node_id TEXT PRIMARY KEY,
    comment TEXT NOT NULL
  )
`);

const upsertStmt = db.prepare(`
  INSERT INTO comments (node_id, comment)
  VALUES (@nodeId, @comment)
  ON CONFLICT(node_id) DO UPDATE SET comment = excluded.comment
`);
const deleteStmt = db.prepare("DELETE FROM comments WHERE node_id = ?");

function getAll(nodeIds) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return {};
  }

  const placeholders = nodeIds.map(() => "?").join(", ");
  const stmt = db.prepare(`SELECT node_id, comment FROM comments WHERE node_id IN (${placeholders})`);
  const rows = stmt.all(...nodeIds);
  const mapped = {};
  for (const row of rows) {
    mapped[row.node_id] = row.comment;
  }
  return mapped;
}

function upsert(nodeId, text) {
  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  if (!text || !String(text).trim()) {
    deleteStmt.run(nodeId);
    return;
  }

  upsertStmt.run({ nodeId, comment: String(text) });
}

module.exports = {
  getAll,
  upsert,
};
