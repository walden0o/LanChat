/**
 * 认证与用户管理路由。
 * - POST /api/register  注册（首个注册用户自动成为管理员）
 * - POST /api/login     登录，返回 JWT
 * - GET  /api/users     用户列表（管理员）
 * - POST /api/users/:id/disable   禁用/启用（管理员）
 * - POST /api/users/:id/admin     授予/撤销管理员（管理员）
 * - DELETE /api/users/:id         删除用户（管理员，不能删自己）
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, stmt, getStorageSettings, DATA_DIR, MAX_UPLOAD_HARD_CAP_MB } = require('../db');

/** 上传目录（与 routes/files.js 保持一致）。 */
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');

const JWT_SECRET = process.env.JWT_SECRET || 'lanchat-dev-secret-change-me';
const TOKEN_TTL = process.env.TOKEN_TTL || '7d';

const router = express.Router();

/** 通知所有在线客户端刷新通讯录（注册/禁用/删除/改管理员后调用）。 */
function notifyContactsChanged(req) {
  req.app.get('io')?.emit('contacts:changed');
}

const USERNAME_RE = /^[A-Za-z0-9_-]{2,32}$/;

/**
 * 从 Authorization: Bearer <token> 解析并校验 JWT，返回用户行或 null。
 * @param {import('express').Request} req
 * @returns {object|null}
 */
function getUserFromReq(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = stmt.findUserById.get(payload.uid);
    if (!user || user.is_disabled) return null;
    return user;
  } catch {
    return null;
  }
}

/** Express 中间件：要求登录。 */
function requireAuth(req, res, next) {
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ error: '未登录或登录已过期' });
  req.user = user;
  next();
}

/** Express 中间件：要求管理员。 */
function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

/** 校验 Socket.IO 握手携带的 token，供 socket 层复用。 */
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = stmt.findUserById.get(payload.uid);
    if (!user || user.is_disabled) return null;
    return user;
  } catch {
    return null;
  }
}

function issueToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    isAdmin: !!user.is_admin,
  };
}

router.post('/register', (req, res) => {
  const { username, password, nickname } = req.body || {};
  if (!USERNAME_RE.test(username || '')) {
    return res.status(400).json({ error: '用户名需为 2-32 位字母/数字/下划线/中划线' });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: '密码长度需为 6-128 位' });
  }
  const displayName = (nickname || '').trim() || username;
  if (displayName.length > 32) {
    return res.status(400).json({ error: '昵称最长 32 个字符' });
  }
  if (stmt.findUserByName.get(username)) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  // 第一个注册用户自动成为管理员
  const isFirst = stmt.countUsers.get().n === 0;
  const hash = bcrypt.hashSync(password, 10);
  const info = stmt.createUser.run(username, hash, displayName, isFirst ? 1 : 0);
  const user = stmt.findUserById.get(info.lastInsertRowid);
  notifyContactsChanged(req);
  res.json({ token: issueToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = stmt.findUserByName.get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (user.is_disabled) {
    return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
  }
  res.json({ token: issueToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// 通讯录：所有登录用户可见（私聊需要看到未在线的联系人）
router.get('/contacts', requireAuth, (req, res) => {
  const users = stmt.listUsers
    .all()
    .filter((u) => !u.is_disabled)
    .map((u) => ({ id: u.id, nickname: u.nickname }));
  res.json({ users });
});

// ---------- 管理员接口 ----------

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: stmt.listUsers.all() });
});

router.post('/users/:id/disable', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const target = stmt.findUserById.get(targetId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (targetId === req.user.id) return res.status(400).json({ error: '不能禁用自己' });
  const disabled = target.is_disabled ? 0 : 1;
  stmt.setUserDisabled.run(disabled, targetId);
  // 通知 socket 层踢掉被禁用的在线用户
  req.app.get('kickUser')?.(targetId);
  notifyContactsChanged(req);
  res.json({ ok: true, isDisabled: !!disabled });
});

router.post('/users/:id/admin', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const target = stmt.findUserById.get(targetId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (targetId === req.user.id) return res.status(400).json({ error: '不能修改自己的管理员身份' });
  const isAdmin = target.is_admin ? 0 : 1;
  stmt.setUserAdmin.run(isAdmin, targetId);
  res.json({ ok: true, isAdmin: !!isAdmin });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const target = stmt.findUserById.get(targetId);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (targetId === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  req.app.get('kickUser')?.(targetId);

  // 事务内级联清理：消息、文件记录、磁盘上的文件、用户本身
  const storedNames = stmt.listFilesByUser.all(targetId).map((f) => f.stored_name);
  db.transaction(() => {
    stmt.deleteMessagesByUser.run(targetId, targetId);
    stmt.deleteFilesByUser.run(targetId);
    stmt.deleteReadsByUser.run(targetId);
    stmt.deleteUser.run(targetId);
  })();
  for (const name of storedNames) {
    fs.rmSync(path.join(UPLOAD_DIR, name), { force: true });
  }
  notifyContactsChanged(req);
  res.json({ ok: true });
});

// ---------- 消息搜索 ----------

/** 转义 LIKE 通配符，防止用户输入 %/_ 引发全表匹配。 */
function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// 全局搜索"我可见"的消息（群聊 + 自己参与的私聊），最多 50 条
router.get('/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const rows = stmt.searchMessages.all(
    req.user.id,
    req.user.id,
    `%${escapeLike(q)}%`,
    50
  );
  res.json({
    results: rows.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      senderNickname: r.sender_nickname,
      receiverId: r.receiver_id,
      // 截取关键词附近的片段，避免长消息刷屏
      snippet: makeSnippet(r.content, q),
      createdAt: r.created_at,
    })),
  });
});

/** 返回关键词前后各 40 字符的片段。 */
function makeSnippet(content, q) {
  const i = content.indexOf(q);
  if (i < 0) return content.slice(0, 80);
  const start = Math.max(0, i - 40);
  const end = Math.min(content.length, i + q.length + 40);
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
}

// ---------- 存储统计（管理员）----------

router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  const dbFile = path.join(DATA_DIR, 'lanchat.db');
  let dbBytes = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      dbBytes += fs.statSync(dbFile + suffix).size;
    } catch {
      /* 文件可能不存在 */
    }
  }
  // 上传目录所在分区容量（大文件场景下管理员需关注剩余空间）
  let disk = null;
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const s = fs.statfsSync(UPLOAD_DIR);
    disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    /* 平台不支持 statfs 时不返回 */
  }
  res.json({
    stats: {
      messageCount: stmt.countMessages.get().n,
      fileCount: stmt.fileStats.get().n,
      fileBytes: stmt.fileStats.get().bytes,
      dbBytes,
      disk,
      byUser: stmt.filesByUser.all(),
    },
  });
});

// ---------- 存储管理：保留时间设置（管理员）----------

// 读取保留时间设置
router.get('/storage-settings', requireAuth, requireAdmin, (req, res) => {
  res.json({ settings: getStorageSettings() });
});

// 修改保留时间（文件/消息独立，1-3650 天），保存后下一轮清理即生效
router.post('/storage-settings', requireAuth, requireAdmin, (req, res) => {
  const { fileTtlDays, messageTtlDays, maxUploadMb } = req.body || {};
  const apply = (key, v) => {
    if (v === undefined || v === null || v === '') return; // 未提交的字段不动
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      throw new Error('保留天数需为 1-3650 的整数');
    }
    stmt.setSetting.run(key, String(n));
  };
  const applyUploadMb = (v) => {
    if (v === undefined || v === null || v === '') return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > MAX_UPLOAD_HARD_CAP_MB) {
      throw new Error(`上传上限需为 1-${MAX_UPLOAD_HARD_CAP_MB} 的整数（MB）`);
    }
    stmt.setSetting.run('max_upload_mb', String(n));
  };
  try {
    apply('file_ttl_days', fileTtlDays);
    apply('message_ttl_days', messageTtlDays);
    applyUploadMb(maxUploadMb);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json({ settings: getStorageSettings() });
});

// 手动触发一轮过期清理，返回清理条数
router.post('/cleanup', requireAuth, requireAdmin, (req, res) => {
  const { cleanup } = require('../cleanup');
  res.json({ result: cleanup() });
});

// ---------- 文件管理：列表 / 删除（管理员）----------

// 文件列表（最新在前，默认 200 条，可 ?limit= 指定）
router.get('/files', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const files = stmt.listFiles.all(limit).map((f) => ({
    id: f.id,
    name: f.original_name,
    size: f.size,
    mime: f.mime_type,
    uploaderId: f.uploader_id,
    uploaderNickname: f.uploader_nickname,
    createdAt: f.created_at,
  }));
  res.json({ files });
});

/**
 * 删除文件：事务内删记录 + 引用它的消息，事务外删磁盘文件。
 * 删消息是为了不留下打不开的"死"文件卡片。
 * 磁盘删除失败不阻塞接口（记录已删，残留文件由清理任务兜底）。
 */
router.delete('/files/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const file = stmt.findFileById.get(id);
  if (!file) return res.status(404).json({ error: '文件不存在' });

  const deletedMessages = db.transaction(() => {
    const msgs = stmt.deleteMessagesByFileId.run(id).changes;
    stmt.deleteFileById.run(id);
    return msgs;
  })();
  fs.rmSync(path.join(UPLOAD_DIR, file.stored_name), { force: true });

  // 通知在线客户端，实时移除消息流中的该文件卡片
  req.app.get('io')?.emit('file:deleted', { id });

  res.json({ ok: true, deletedMessages });
});

module.exports = { router, requireAuth, verifyToken };
