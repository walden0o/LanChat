/**
 * Socket.IO 实时消息层。
 *
 * 事件约定（客户端 → 服务端）：
 *   message:send      { to: number|null, type: 'text'|'file', content: string }
 *                     to 为 null 表示群聊；否则为私聊对象的用户 id。
 *   history:group     { limit?: number } → 回调返回群聊历史
 *   history:private   { userId: number, limit?: number } → 回调返回私聊历史
 *   typing            { to: number|null } → 转发"正在输入"提示（不入库）
 *
 * 事件约定（服务端 → 客户端）：
 *   message:new       完整消息对象（含 sender_nickname）
 *   presence:list     在线用户列表 [{id, nickname}]
 *   presence:join     {id, nickname} 某人上线
 *   presence:leave    {id} 某人下线
 *   typing            { from, to } 某人正在输入
 *   kicked            当前账号被禁用/删除，需强制登出
 */
const { stmt } = require('../db');
const { verifyToken } = require('../routes/auth');

const MAX_TEXT_LEN = 4000;
const HISTORY_DEFAULT = 100;
const HISTORY_MAX = 500;

/**
 * 将消息行序列化为发送给客户端的对象。
 * file 类型的 content 为 JSON 字符串，这里解析成对象。
 */
function serializeMessage(row) {
  return {
    id: row.id,
    senderId: row.sender_id,
    senderNickname: row.sender_nickname,
    receiverId: row.receiver_id,
    type: row.type,
    content: row.type === 'file' ? JSON.parse(row.content) : row.content,
    createdAt: row.created_at,
  };
}

/**
 * @param {import('socket.io').Server} io
 * @returns {{ kickUser: (userId: number) => void }}
 */
function setupChat(io) {
  /** userId -> Set<socketId>，支持同一账号多标签页在线 */
  const onlineSockets = new Map();

  function onlineList() {
    return [...onlineSockets.keys()].map((id) => {
      const u = stmt.findUserById.get(id);
      return { id, nickname: u ? u.nickname : `#${id}` };
    });
  }

  function kickUser(userId) {
    const sockets = onlineSockets.get(userId);
    if (!sockets) return;
    for (const sid of sockets) {
      const s = io.sockets.sockets.get(sid);
      s?.emit('kicked');
      s?.disconnect(true);
    }
  }

  // 握手鉴权：客户端在 auth.token 中携带 JWT
  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const me = socket.user;
    socket.join(`user:${me.id}`);

    if (!onlineSockets.has(me.id)) onlineSockets.set(me.id, new Set());
    const set = onlineSockets.get(me.id);
    const firstSocket = set.size === 0;
    set.add(socket.id);

    socket.emit('presence:list', onlineList());
    if (firstSocket) {
      socket.broadcast.emit('presence:join', { id: me.id, nickname: me.nickname });
    }

    socket.on('message:send', (payload, ack) => {
      try {
        const { to = null, type = 'text', content } = payload || {};
        if (type === 'text') {
          if (typeof content !== 'string' || !content.trim()) {
            return ack?.({ error: '消息不能为空' });
          }
          if (content.length > MAX_TEXT_LEN) {
            return ack?.({ error: `消息长度超过 ${MAX_TEXT_LEN} 字符` });
          }
        } else if (type === 'file') {
          const meta = typeof content === 'object' ? content : JSON.parse(content);
          const file = stmt.findFileById.get(meta.fileId);
          if (!file || file.uploader_id !== me.id) {
            return ack?.({ error: '文件无效' });
          }
        } else {
          return ack?.({ error: '不支持的消息类型' });
        }

        let receiverId = null;
        if (to !== null && to !== undefined) {
          const target = stmt.findUserById.get(Number(to));
          if (!target || target.is_disabled) return ack?.({ error: '接收者不存在或已禁用' });
          receiverId = target.id;
        }

        const stored =
          type === 'file' ? JSON.stringify(content) : String(content).slice(0, MAX_TEXT_LEN);
        const info = stmt.insertMessage.run(me.id, receiverId, type, stored);
        const row = {
          id: info.lastInsertRowid,
          sender_id: me.id,
          sender_nickname: me.nickname,
          receiver_id: receiverId,
          type,
          content: stored,
          created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        };
        const msg = serializeMessage(row);

        if (receiverId === null) {
          io.emit('message:new', msg);
        } else {
          io.to(`user:${receiverId}`).to(`user:${me.id}`).emit('message:new', msg);
        }
        ack?.({ ok: true, id: msg.id });
      } catch (err) {
        ack?.({ error: '发送失败' });
      }
    });

    socket.on('history:group', (payload, cb) => {
      const limit = Math.min(Number(payload?.limit) || HISTORY_DEFAULT, HISTORY_MAX);
      const rows = stmt.groupHistory.all(limit).reverse();
      cb?.(rows.map(serializeMessage));
    });

    socket.on('history:private', (payload, cb) => {
      const peerId = Number(payload?.userId);
      if (!Number.isInteger(peerId) || peerId <= 0) return cb?.([]);
      const limit = Math.min(Number(payload?.limit) || HISTORY_DEFAULT, HISTORY_MAX);
      const rows = stmt.privateHistory.all(me.id, peerId, peerId, me.id, limit).reverse();
      cb?.(rows.map(serializeMessage));
    });

    socket.on('typing', (payload) => {
      const to = payload?.to ?? null;
      const evt = { from: me.id, nickname: me.nickname, to };
      if (to === null) socket.broadcast.emit('typing', evt);
      else io.to(`user:${Number(to)}`).emit('typing', evt);
    });

    socket.on('disconnect', () => {
      const sockets = onlineSockets.get(me.id);
      if (!sockets) return;
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineSockets.delete(me.id);
        io.emit('presence:leave', { id: me.id });
      }
    });
  });

  return { kickUser };
}

module.exports = { setupChat };
