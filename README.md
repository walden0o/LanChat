# Local QQ — 局域网即时通讯工具

一个部署在内网的极简版 QQ：网页登录、群聊 / 私聊、文件传输、用户管理。
服务端运行在你本机，局域网内其他人直接用浏览器访问，无需安装任何客户端。

## 功能

- **注册 / 登录**：账号密码认证（bcrypt 哈希 + JWT），首个注册用户自动成为管理员
- **群聊**：公共频道，所有人在同一房间聊天
- **私聊**：点击联系人即可一对一聊天，消息持久化可回看
- **文件传输**：群聊/私聊中均可发送文件（默认上限 500MB），点击消息卡片下载
- **图片 / 视频预览**：图片在消息流内缩略显示、点击看大图；视频内联播放、可拖进度条
- **文本预览**：`.txt`/`.md`/`.json`/代码文件等点击即在弹窗预览；大文件只拉取前 256KB（HTTP Range）
- **用户管理**：管理员可禁用 / 启用、授予 / 撤销管理员、删除用户；禁用和删除会实时踢下线
- **在线状态**：联系人列表实时显示谁在线；未读消息角标；"正在输入"提示
- **数据有效期**：消息与文件默认保留 5 天，服务端每小时自动清理过期数据（含磁盘文件）

## 快速开始

要求：Node.js ≥ 20（已在 Node 22 上验证）。

```bash
# 1. 安装依赖
npm install
npm --prefix client install

# 2. 构建前端（产物输出到 client/dist，由服务端托管）
npm run build:client

# 3. 启动服务（监听 0.0.0.0:1111）
npm start
```

启动后：

- 本机访问 `http://localhost:1111`
- 局域网其他人访问 `http://<你的IP>:1111`

查看本机 IP：`ip addr`（Linux）或 `ipconfig`（Windows），找局域网网卡的 IPv4 地址，例如 `192.168.x.x`。

> 如果同事打不开页面，多半是系统防火墙拦了 1111 端口，放行即可。

## 开发模式

```bash
# 终端 1：后端（改动自动重启）
npm run dev

# 终端 2：前端热更新（5173 端口，已配置 /api 和 /socket.io 代理到 1111）
npm --prefix client run dev
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `1111` | 服务端口 |
| `JWT_SECRET` | 内置开发值 | **生产部署务必设置**，例如 `JWT_SECRET=$(openssl rand -hex 32) npm start` |
| `TOKEN_TTL` | `7d` | 登录态有效期 |
| `MAX_FILE_SIZE_MB` | `500` | 单文件大小上限（MB） |
| `DATA_TTL_DAYS` | `5` | 消息与文件保留天数，过期自动删除（用户账号不过期） |

## 开机自启动（systemd 用户服务，无需 root）

本仓库提供单元模板 `deploy/local-qq.service`：

```bash
# 1. 允许用户服务在未登录时运行（本机已开启）
loginctl enable-linger

# 2. 复制并修改模板（WorkingDirectory、node 路径、JWT_SECRET）
mkdir -p ~/.config/systemd/user
cp deploy/local-qq.service ~/.config/systemd/user/
# 编辑 ~/.config/systemd/user/local-qq.service，替换 CHANGE_ME 等占位

# 3. 启用并启动
systemctl --user daemon-reload
systemctl --user enable --now local-qq

# 常用运维命令
systemctl --user status local-qq    # 查看状态
systemctl --user restart local-qq   # 重启
journalctl --user -u local-qq -f    # 查看日志
```

## 数据存放

- `data/local-qq.db` — SQLite 数据库（用户、消息、文件元数据）
- `uploads/` — 上传的文件实体

删除这两个目录即可完全重置（用户需重新注册，首个注册用户重新成为管理员）。

## 目录结构

```
server/
  index.js          # 入口：Express + Socket.IO + 托管前端产物
  db.js             # SQLite 表结构与查询语句
  routes/auth.js    # 注册/登录/JWT/管理员接口/通讯录
  routes/files.js   # 文件上传与下载
  socket/chat.js    # 实时消息、在线状态、历史记录、踢人
client/             # Vue 3 + Vite 前端
  src/store.js      # 全局状态 + socket 客户端逻辑
  src/views/        # 登录页 / 聊天主页
  test-e2e.cjs      # 端到端冒烟测试（需服务已启动）
```

## 冒烟测试

服务运行中执行：

```bash
cd client && node test-e2e.cjs
```

会模拟两个用户跑通：注册→登录→群聊→私聊→历史→文件上传/下载→管理员禁用/删除。
注意：测试会在数据库中残留测试账号，建议在干净数据库上运行或测试后重置。

## 安全说明

- 按内网受信任环境设计：HTTP 明文传输，无 HTTPS。**不要在公网部署**。
- 文件下载、接口访问都要求登录态；socket 握手同样校验 JWT。
- 上传文件以随机名存储，下载通过后端鉴权转发，无法直接猜路径。
