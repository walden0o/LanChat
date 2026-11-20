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
const { stmt, getMaxUploadMb, MAX_UPLOAD_HARD_CAP_MB } = require('../db');
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

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * 单文件大小上限（MB）：管理员可在存储设置中运行时调整（1-20480，即最高 20GB）。
 * multer 的 limits 在构造时固定，这里用 20GB 硬顶作兜底，
 * 实际上限在路由内按当前设置动态校验（Content-Length 预检 + 落盘后复核）。
 */
const limitBytes = () => getMaxUploadMb() * 1024 * 1024;
const HARD_CAP = MAX_UPLOAD_HARD_CAP_MB * 1024 * 1024;

/** 上限文案：≥1024MB 显示为 GB。 */
function limitText() {
  const mb = getMaxUploadMb();
  return mb >= 1024 ? `${+(mb / 1024).toFixed(2)} GB` : `${mb} MB`;
}

/** 写入后至少保留的磁盘余量，避免把磁盘写满拖垮数据库与系统。 */
const DISK_RESERVE_BYTES = 1024 * 1024 * 1024;

/** 上传目录所在分区的可用字节数；平台不支持时返回 Infinity（跳过检查）。 */
function freeDiskBytes() {
  try {
    const s = fs.statfsSync(UPLOAD_DIR);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  // 随机存储名 + 保留扩展名，避免冲突与路径注入
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 16);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const router = express.Router();

/** 当前上传上限（登录即可查，客户端用于发送前预检与提示）。 */
router.get('/limit', requireAuth, (req, res) => {
  res.json({ maxUploadMb: getMaxUploadMb() });
});

/** Content-Length 预检：超限或磁盘空间不足直接拒绝，不落盘。 */
router.post('/', requireAuth, (req, res, next) => {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limitBytes() + 64 * 1024) {
    return res.status(413).json({ error: `文件超过大小上限（${limitText()}）` });
  }
  if (Number.isFinite(declared) && declared + DISK_RESERVE_BYTES > freeDiskBytes()) {
    return res.status(507).json({ error: '服务器磁盘空间不足，请联系管理员清理后再试' });
  }
  // 客户端中途取消/断网（请求体未收完）：兜底删除可能残留的临时文件
  req.on('close', () => {
    if (!req.complete && req.file?.path) fs.unlink(req.file.path, () => {});
  });
  uploadMiddleware(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `文件超过大小上限（${limitText()}）` : '上传失败';
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      if (res.headersSent || req.destroyed) return;
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg });
    }
    next();
  });
});

const uploadMiddleware = multer({ storage, limits: { fileSize: HARD_CAP } }).single('file');

router.post('/', (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  // 复核实际大小（无 Content-Length 的分块请求在此拦截），超限删除临时文件
  if (req.file.size > limitBytes()) {
    fs.unlink(req.file.path, () => {});
    return res.status(413).json({ error: `文件超过大小上限（${limitText()}）` });
  }
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
