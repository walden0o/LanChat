/**
 * 文件上传 / 下载路由。
 * - POST   /api/files        上传（multipart，字段名 file），返回文件元信息
 * - GET    /api/files/:id    获取文件（需登录）。
 *                            图片/音视频 → inline 内联预览，支持 Range（视频可拖进度条）；
 *                            其余类型或带 ?dl=1 → attachment 附件下载。
 *                            除 Authorization 头外还接受 ?token=，
 *                            因为 <img>/<video> 标签无法携带请求头。
 *
 * 文件传输采用 HTTP 而非 WebSocket：HTTP 有成熟的流式/断点处理，
 * 大文件不会阻塞消息通道，实现也更简单。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { stmt } = require('../db');
const { requireAuth, verifyToken } = require('./auth');

/** 可安全内联预览的类型；SVG 可执行脚本，必须排除。 */
const INLINE_RE = /^(image\/(?!svg)|video\/|audio\/|text\/plain)/;

/**
 * 鉴权中间件：优先 Authorization 头，缺失时回退 ?token= 查询参数。
 * 仅用于文件获取路由，使 <img>/<video src> 能直接引用。
 */
function requireAuthOrQuery(req, res, next) {
  if (!req.headers.authorization && req.query.token) {
    const user = verifyToken(String(req.query.token));
    if (!user) return res.status(401).json({ error: '未登录或登录已过期' });
    req.user = user;
    return next();
  }
  return requireAuth(req, res, next);
}

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** 单文件大小上限（默认 500MB，可用 MAX_FILE_SIZE_MB 覆盖）。 */
const MAX_FILE_SIZE = (Number(process.env.MAX_FILE_SIZE_MB) || 500) * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // 随机存储名 + 保留扩展名，避免冲突与路径注入
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 16);
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
});

const router = express.Router();

router.post('/', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  // multer 对 originalname 按 latin1 解码，中文文件名需转回 utf8
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const info = stmt.insertFile.run(
    req.user.id,
    req.file.filename,
    originalName,
    req.file.mimetype || 'application/octet-stream',
    req.file.size
  );
  res.json({
    fileId: info.lastInsertRowid,
    name: originalName,
    size: req.file.size,
    mime: req.file.mimetype || 'application/octet-stream',
  });
});

router.get('/:id', requireAuthOrQuery, (req, res) => {
  const file = stmt.findFileById.get(Number(req.params.id));
  if (!file) return res.status(404).json({ error: '文件不存在' });
  const absPath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(absPath)) return res.status(410).json({ error: '文件已被删除' });
  const asAttachment = req.query.dl === '1' || !INLINE_RE.test(file.mime_type);
  // sendFile 自带 HTTP Range 支持，视频播放可拖动进度条
  res.sendFile(absPath, {
    headers: {
      'Content-Type': file.mime_type,
      // RFC 5987 编码，保证中文文件名在各浏览器正常显示
      'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
    },
  });
});

module.exports = { router };
