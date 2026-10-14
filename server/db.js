/**
 * SQLite 数据层：负责数据库初始化与所有表的访问。
 * 使用 better-sqlite3（同步 API），对本工具的低并发场景足够且最简单。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

/** 数据保留天数（消息与文件），默认 5 天，可用 DATA_TTL_DAYS 覆盖。 */
const TTL_DAYS = Math.max(1, parseInt(process.env.DATA_TTL_DAYS || '5', 10) || 5);
// created_at 以 datetime('now','localtime') 存储，构造等价的过期时间表达式。
// TTL_DAYS 已保证为整数，内联进 SQL 无注入风险。
const EXPIRED = `datetime('now','localtime','-${TTL_DAYS} days')`;

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

-- 已读回执：每个用户在每个私聊会话中"已读到的最大消息 id"
CREATE TABLE IF NOT EXISTS user_reads (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  conv_key     TEXT NOT NULL,             -- 会话 key，如 'u:3'
  last_read_id INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (user_id, conv_key)
);
`);

// 轻量迁移：为旧库补 revoked（撤回标记）列
try {
  db.exec(`ALTER TABLE messages ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0`);
} catch {
  /* 列已存在 */
}

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
  deleteReadsByUser: db.prepare('DELETE FROM user_reads WHERE user_id = ?'),

  // ---- 过期清理（数据有效期 TTL_DAYS 天）----
  expiredFiles: db.prepare(
    `SELECT id, stored_name FROM files WHERE created_at < ${EXPIRED}`
  ),
  deleteExpiredFiles: db.prepare(`DELETE FROM files WHERE created_at < ${EXPIRED}`),
  deleteExpiredMessages: db.prepare(
    `DELETE FROM messages WHERE created_at < ${EXPIRED}`
  ),
  // 文件已不在（过期/被删）但消息还在的情况：清理这类"死"文件消息
  deleteOrphanFileMessages: db.prepare(
    `DELETE FROM messages WHERE type = 'file'
       AND CAST(json_extract(content, '$.fileId') AS INTEGER) NOT IN (SELECT id FROM files)`
  ),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),

  insertFile: db.prepare(
    'INSERT INTO files (uploader_id, stored_name, original_name, mime_type, size) VALUES (?, ?, ?, ?, ?)'
  ),
  findFileById: db.prepare('SELECT * FROM files WHERE id = ?'),
  // 存储管理：文件列表（含上传者昵称，最新在前）
  listFiles: db.prepare(
    `SELECT f.id, f.original_name, f.mime_type, f.size, f.created_at,
            f.uploader_id, u.nickname AS uploader_nickname
     FROM files f JOIN users u ON u.id = f.uploader_id
     ORDER BY f.id DESC LIMIT ?`
  ),
  deleteFileById: db.prepare('DELETE FROM files WHERE id = ?'),
  // 删除引用某文件的消息（避免留下打不开的"死"文件消息）
  deleteMessagesByFileId: db.prepare(
    `DELETE FROM messages WHERE type = 'file'
       AND CAST(json_extract(content, '$.fileId') AS INTEGER) = ?`
  ),

  insertMessage: db.prepare(
    'INSERT INTO messages (sender_id, receiver_id, type, content) VALUES (?, ?, ?, ?)'
  ),
  getMessageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
  revokeMessage: db.prepare('UPDATE messages SET revoked = 1 WHERE id = ?'),

  // ---- 已读回执 ----
  upsertRead: db.prepare(`
    INSERT INTO user_reads (user_id, conv_key, last_read_id) VALUES (?, ?, ?)
    ON CONFLICT(user_id, conv_key)
    DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id),
                  updated_at = datetime('now','localtime')`),
  // 某私聊会话中当前最新一条消息 id（上报已读时取）
  lastPrivateMessageId: db.prepare(
    `SELECT MAX(id) AS id FROM messages
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`
  ),

  // ---- 消息搜索（LIKE 支持中文子串；仅限"我可见"的消息）----
  searchMessages: db.prepare(
    `SELECT m.*, u.nickname AS sender_nickname FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE (m.receiver_id IS NULL OR m.sender_id = ? OR m.receiver_id = ?)
       AND m.revoked = 0
       AND m.content LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT ?`
  ),

  // ---- 存储统计 ----
  countMessages: db.prepare('SELECT COUNT(*) AS n FROM messages'),
  fileStats: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM files'),
  filesByUser: db.prepare(
    `SELECT u.id, u.username, u.nickname, COUNT(f.id) AS count, COALESCE(SUM(f.size),0) AS bytes
     FROM users u LEFT JOIN files f ON f.uploader_id = u.id
     GROUP BY u.id ORDER BY bytes DESC`
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

module.exports = { db, stmt, TTL_DAYS };
