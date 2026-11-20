/**
 * SQLite 数据层：负责数据库初始化与所有表的访问。
 * 使用 better-sqlite3（同步 API），对本工具的低并发场景足够且最简单。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

/** 数据保留天数：默认取环境变量，管理员可在运行时通过 settings 表覆盖。 */
const DEFAULT_TTL_DAYS = Math.max(1, parseInt(process.env.DATA_TTL_DAYS || '5', 10) || 5);

const db = new Database(path.join(DATA_DIR, 'lanchat.db'));
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

-- 管理员可调设置（key-value）；保留天数未设置时回退 DEFAULT_TTL_DAYS
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

  // ---- 过期清理（保留天数由 settings 表动态决定，调用方传入修饰符如 '-5 days'）----
  expiredFiles: db.prepare(
    `SELECT id, stored_name FROM files WHERE created_at < datetime('now','localtime', ?)`
  ),
  deleteExpiredFiles: db.prepare(
    `DELETE FROM files WHERE created_at < datetime('now','localtime', ?)`
  ),
  deleteExpiredMessages: db.prepare(
    `DELETE FROM messages WHERE created_at < datetime('now','localtime', ?)`
  ),
  // 文件已不在（过期/被删）但消息还在的情况：清理这类"死"文件消息。
  // 仅清理已过消息保留期的，避免文件 TTL 较短时把未到期消息提前删掉。
  deleteOrphanFileMessages: db.prepare(
    `DELETE FROM messages WHERE type = 'file'
       AND created_at < datetime('now','localtime', ?)
       AND CAST(json_extract(content, '$.fileId') AS INTEGER) NOT IN (SELECT id FROM files)`
  ),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),

  // ---- 运行时设置（存储保留时间等）----
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = datetime('now','localtime')`),

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
  // 群聊当前最新消息 id（群聊已读上报用）
  lastGroupMessageId: db.prepare(
    `SELECT MAX(id) AS id FROM messages WHERE receiver_id IS NULL`
  ),
  // 某会话中所有人的已读位置：连接时下发，用于"回拉已读"
  readMarksOfConv: db.prepare(
    'SELECT user_id, last_read_id FROM user_reads WHERE conv_key = ?'
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

/** 读取保留天数设置（1-3650），未设置或非法时回退默认值。key: 'file_ttl_days' | 'message_ttl_days' */
function getTtlDays(key) {
  const row = stmt.getSetting.get(key);
  const n = parseInt(row?.value, 10);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_TTL_DAYS;
}

/** 单文件上传大小上限（MB）：默认 20GB，可用环境变量覆盖，管理员可通过 settings 表在运行时覆盖。 */
const MAX_UPLOAD_HARD_CAP_MB = 20480; // 20GB 硬顶
const DEFAULT_MAX_UPLOAD_MB = Math.min(Number(process.env.MAX_FILE_SIZE_MB) || MAX_UPLOAD_HARD_CAP_MB, MAX_UPLOAD_HARD_CAP_MB);

/** 当前生效的上传上限（MB）。 */
function getMaxUploadMb() {
  const row = stmt.getSetting.get('max_upload_mb');
  const n = parseInt(row?.value, 10);
  return Number.isInteger(n) && n >= 1 && n <= MAX_UPLOAD_HARD_CAP_MB ? n : DEFAULT_MAX_UPLOAD_MB;
}

/** 读取全部存储设置（供管理面板展示）。 */
function getStorageSettings() {
  return {
    fileTtlDays: getTtlDays('file_ttl_days'),
    messageTtlDays: getTtlDays('message_ttl_days'),
    defaultTtlDays: DEFAULT_TTL_DAYS,
    maxUploadMb: getMaxUploadMb(),
    defaultMaxUploadMb: DEFAULT_MAX_UPLOAD_MB,
    maxUploadCapMb: MAX_UPLOAD_HARD_CAP_MB,
  };
}

module.exports = {
  db,
  stmt,
  DATA_DIR,
  TTL_DAYS: DEFAULT_TTL_DAYS,
  getTtlDays,
  getStorageSettings,
  getMaxUploadMb,
  MAX_UPLOAD_HARD_CAP_MB,
};
