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
const { db, stmt } = require('../db');

/** 上传目录（与 routes/files.js 保持一致）。 */
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const JWT_SECRET = process.env.JWT_SECRET || 'local-qq-dev-secret-change-me';
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
    stmt.deleteUser.run(targetId);
  })();
  for (const name of storedNames) {
    fs.rmSync(path.join(UPLOAD_DIR, name), { force: true });
  }
  notifyContactsChanged(req);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, verifyToken };
