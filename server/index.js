/**
 * 服务入口：Express + Socket.IO。
 * - /api/*        REST 接口（认证、文件）
 * - /socket.io    实时消息
 * - /*            托管 client/dist 前端构建产物（SPA）
 *
 * 监听 0.0.0.0 使局域网内其他机器可访问。
 * 环境变量：PORT（默认 1111）、JWT_SECRET、MAX_FILE_SIZE_MB、TOKEN_TTL、DATA_TTL_DAYS（默认 5）
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const auth = require('./routes/auth');
const files = require('./routes/files');
const { setupChat } = require('./socket/chat');
const { startCleanupJob } = require('./cleanup');

const PORT = Number(process.env.PORT) || 1111;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api', auth.router);
app.use('/api/files', files.router);

// 托管前端构建产物；未构建时提示先跑 npm run build:client
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(503)
      .send('前端尚未构建：请先运行 npm --prefix client install && npm run build:client');
  });
}

const server = http.createServer(app);
// Node 18+ 默认 requestTimeout=300s，会掐断大文件（最高 20GB）的慢速上传；
// 局域网内部工具，关闭整请求超时，仅保留请求头超时防慢速攻击。
server.requestTimeout = 0;
server.headersTimeout = 60 * 1000;
const io = new Server(server, {
  // 消息主体很小，调大容忍度即可；文件走 HTTP 上传
  maxHttpBufferSize: 1e6,
});
const { kickUser } = setupChat(io);
app.set('kickUser', kickUser);
app.set('io', io);
startCleanupJob();

server.listen(PORT, HOST, () => {
  console.log(`[local-qq] 服务已启动: http://${HOST}:${PORT}`);
  console.log(`[local-qq] 局域网访问: http://<本机IP>:${PORT}`);
});
