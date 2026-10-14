/**
 * SQLite 数据层：负责数据库初始化与所有表的访问。
 * 使用 better-sqlite3（同步 API），对本工具的低并发场景足够且最简单。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'local-qq.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_disabled   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uploader_id   INTEGER NOT NULL REFERENCES users(id),
  stored_name   TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),   -- NULL 表示群聊（公共频道）
  type        TEXT NOT NULL DEFAULT 'text',   -- 'text' | 'file'
  content     TEXT NOT NULL,                  -- 文本内容；file 类型存 JSON：{fileId, name, size, mime}
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(receiver_id, id)
  WHERE receiver_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(sender_id, receiver_id, id);
`);

/** 供外部使用的查询语句集合。 */
const stmt = {
  findUserByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare(
    'INSERT INTO users (username, password_hash, nickname, is_admin) VALUES (?, ?, ?, ?)'
  ),
  listUsers: db.prepare(
    'SELECT id, username, nickname, is_admin, is_disabled, created_at FROM users ORDER BY id'
  ),
  setUserDisabled: db.prepare('UPDATE users SET is_disabled = ? WHERE id = ?'),
  setUserAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  // 级联删除用户相关数据（删除用户前调用）
  deleteMessagesByUser: db.prepare(
    'DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?'
  ),
  listFilesByUser: db.prepare('SELECT stored_name FROM files WHERE uploader_id = ?'),
  deleteFilesByUser: db.prepare('DELETE FROM files WHERE uploader_id = ?'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),

  insertFile: db.prepare(
    'INSERT INTO files (uploader_id, stored_name, original_name, mime_type, size) VALUES (?, ?, ?, ?, ?)'
  ),
  findFileById: db.prepare('SELECT * FROM files WHERE id = ?'),

  insertMessage: db.prepare(
    'INSERT INTO messages (sender_id, receiver_id, type, content) VALUES (?, ?, ?, ?)'
  ),
  // 群聊历史：receiver_id IS NULL，按 id 倒序取最近 N 条再反转
  groupHistory: db.prepare(
    `SELECT m.*, u.nickname AS sender_nickname FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.receiver_id IS NULL
     ORDER BY m.id DESC LIMIT ?`
  ),
  // 私聊历史：两个用户之间双向消息
  privateHistory: db.prepare(
    `SELECT m.*, u.nickname AS sender_nickname FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE (m.sender_id = ? AND m.receiver_id = ?)
        OR (m.sender_id = ? AND m.receiver_id = ?)
     ORDER BY m.id DESC LIMIT ?`
  ),
};

module.exports = { db, stmt };
