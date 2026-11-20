/**
 * 全局状态与 Socket.IO 客户端逻辑。
 * 单文件响应式 store：项目规模小，无需引入 Pinia。
 */
import { reactive, computed } from 'vue'
import { io } from 'socket.io-client'
import { api } from './api.js'

const savedUser = (() => {
  try {
    return JSON.parse(localStorage.getItem('lq_user'))
  } catch {
    return null
  }
})()

export const state = reactive({
  token: localStorage.getItem('lq_token') || '',
  user: savedUser,           // {id, username, nickname, isAdmin}
  socket: null,
  connected: false,
  contacts: [],              // 全部注册用户 [{id, nickname}]
  onlineIds: new Set(),      // 在线用户 id 集合
  currentKey: 'group',       // 当前会话：'group' 或 'u:<id>'
  messages: { group: [] },   // 会话 key -> 消息数组
  lastMsg: {},               // 会话 key -> 最后一条消息（列表预览用）
  loadedKeys: new Set(),     // 已拉取过历史的会话
  unread: {},                // 会话 key -> 未读数
  typing: {},                // 会话 key -> 正在输入的昵称
  readMarks: {},             // 'u:<peer>' -> 对方已读我消息的最大 id（已读回执）
  groupReads: {},            // userId -> 该用户在群聊已读到的最大消息 id
  kickReason: '',
  maxUploadMb: 0,            // 单文件上传上限（MB），连接时拉取
})

/** 头像配色：同一用户 id 恒定取同一颜色。 */
const AVATAR_PALETTE = [
  '#12b7f5', '#ff7a59', '#8a7cff', '#35b26f',
  '#e8a13c', '#e05a9b', '#4f8ff7', '#26b8b0',
]
export function avatarColor(id) {
  return AVATAR_PALETTE[Math.abs(Number(id) || 0) % AVATAR_PALETTE.length]
}

/** 会话列表里的一条消息预览文案。 */
function previewText(m, withSender = false) {
  if (!m) return ''
  if (m.revoked) return `${m.senderNickname} 撤回了一条消息`
  let body
  if (m.type === 'file') {
    const mime = m.content?.mime || ''
    body = /^image\//.test(mime)
      ? '[图片]'
      : /^video\//.test(mime)
        ? '[视频]'
        : `[文件] ${m.content?.name || ''}`
  } else {
    body = String(m.content).replace(/\s+/g, ' ').slice(0, 40)
  }
  return withSender ? `${m.senderNickname}: ${body}` : body
}

/** 会话列表时间：今天显示时分，否则显示月-日。 */
function convTime(m) {
  if (!m?.createdAt) return ''
  const today = new Date().toLocaleDateString('sv')
  return m.createdAt.slice(0, 10) === today ? m.createdAt.slice(11, 16) : m.createdAt.slice(5, 10)
}

/** 会话 key 规则：群聊 'group'，私聊 'u:<对方id>'。 */
export function convKeyOf(msg) {
  if (msg.receiverId === null || msg.receiverId === undefined) return 'group'
  const peer = msg.senderId === state.user.id ? msg.receiverId : msg.senderId
  return `u:${peer}`
}

/** 当前会话的消息数组。 */
export const currentMessages = computed(() => state.messages[state.currentKey] || [])

/** 当前会话标题。 */
export const currentTitle = computed(() => {
  if (state.currentKey === 'group') return '群聊'
  const peerId = Number(state.currentKey.slice(2))
  return state.contacts.find((c) => c.id === peerId)?.nickname || '私聊'
})

/** 侧边栏会话列表：群聊置顶，其余联系人按最新消息时间倒序。 */
export const conversationList = computed(() => {
  const groupMsg = state.lastMsg.group
  const peers = state.contacts
    .filter((c) => c.id !== state.user?.id)
    .map((c) => {
      const key = `u:${c.id}`
      const lm = state.lastMsg[key]
      return {
        key,
        name: c.nickname,
        online: state.onlineIds.has(c.id),
        unread: state.unread[key] || 0,
        preview: previewText(lm),
        time: convTime(lm),
        lastId: lm?.id || 0,
        color: avatarColor(c.id),
      }
    })
    .sort(
      (a, b) =>
        b.lastId - a.lastId || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)
    )
  const selfKey = `u:${state.user?.id}`
  const selfMsg = state.lastMsg[selfKey]
  return [
    {
      key: 'group',
      name: '群聊',
      online: true,
      unread: state.unread.group || 0,
      preview: previewText(groupMsg, true),
      time: convTime(groupMsg),
      color: '#2f80ed',
    },
    {
      // 固定入口：给自己发消息（备忘 / 跨标签页中转）
      key: selfKey,
      name: '我自己',
      online: true,
      unread: state.unread[selfKey] || 0,
      preview: previewText(selfMsg),
      time: convTime(selfMsg),
      lastId: selfMsg?.id || 0,
      color: avatarColor(state.user?.id),
    },
    ...peers,
  ]
})

/** 建立 socket 连接并绑定全部事件。 */
function connectSocket() {
  if (state.socket) return
  const socket = io({ auth: { token: state.token } })
  state.socket = socket

  socket.on('connect', () => {
    state.connected = true
    refreshContacts()
    loadUploadLimit()
    loadHistory(state.currentKey)
    emitReadUpdate(state.currentKey) // 重连后补报当前会话的已读位置
  })
  socket.on('disconnect', () => {
    state.connected = false
  })
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') logout('登录已过期，请重新登录')
  })
  socket.on('kicked', () => {
    logout('账号已被管理员禁用或删除')
  })

  socket.on('presence:list', (list) => {
    state.onlineIds = new Set(list.map((u) => u.id))
  })
  socket.on('presence:join', ({ id }) => state.onlineIds.add(id))
  socket.on('presence:leave', ({ id }) => state.onlineIds.delete(id))
  socket.on('contacts:changed', refreshContacts)

  socket.on('message:new', (msg) => {
    const key = convKeyOf(msg)
    if (!state.messages[key]) state.messages[key] = []
    state.messages[key].push(msg)
    state.lastMsg[key] = msg
    if (key !== state.currentKey && msg.senderId !== state.user.id) {
      state.unread[key] = (state.unread[key] || 0) + 1
    } else if (key === state.currentKey) {
      emitReadUpdate(key) // 正在查看该会话：收到即视为已读
    }
    notifyDesktop(msg, key)
  })

  socket.on('message:revoked', ({ id }) => {
    // 就地标记撤回，前端渲染"已撤回"占位
    for (const list of Object.values(state.messages)) {
      const m = list.find((x) => x.id === id)
      if (m) {
        m.revoked = true
        m.content = null
        break
      }
    }
  })

  // 管理员删除文件：实时移除所有会话中引用该文件的消息
  socket.on('file:deleted', ({ id }) => {
    for (const [key, list] of Object.entries(state.messages)) {
      const kept = list.filter((m) => !(m.type === 'file' && m.content?.fileId === id))
      if (kept.length !== list.length) state.messages[key] = kept
    }
  })

  // 对方已读我的私聊消息：记录其读到的最大 id
  socket.on('read:update', ({ conv, peerId, userId, lastReadId }) => {
    if (conv === 'group') {
      state.groupReads[userId] = Math.max(state.groupReads[userId] || 0, lastReadId)
      return
    }
    const key = `u:${peerId}`
    state.readMarks[key] = Math.max(state.readMarks[key] || 0, lastReadId)
  })

  // 连接时回拉历史已读位置（刷新/重连后已读状态不丢）
  socket.on('read:marks', ({ private: priv = [], group = [] }) => {
    for (const r of priv) {
      const key = `u:${r.user_id}`
      state.readMarks[key] = Math.max(state.readMarks[key] || 0, r.last_read_id)
    }
    for (const r of group) {
      state.groupReads[r.user_id] = Math.max(state.groupReads[r.user_id] || 0, r.last_read_id)
    }
  })

  const typingTimers = {}
  socket.on('typing', ({ from, nickname, to }) => {
    const key = to === null ? 'group' : `u:${from}`
    state.typing[key] = nickname
    clearTimeout(typingTimers[key])
    typingTimers[key] = setTimeout(() => delete state.typing[key], 2500)
  })
}

/** 拉取指定会话的历史消息（仅在首次进入时调用）。 */
function loadHistory(key) {
  if (state.loadedKeys.has(key) || !state.socket?.connected) return
  state.loadedKeys.add(key)
  const done = (rows) => {
    state.messages[key] = rows
    if (rows.length) state.lastMsg[key] = rows[rows.length - 1]
  }
  if (key === 'group') {
    state.socket.emit('history:group', { limit: 200 }, done)
  } else {
    state.socket.emit('history:private', { userId: Number(key.slice(2)), limit: 200 }, done)
  }
}

async function refreshContacts() {
  try {
    const { users } = await api.contacts()
    state.contacts = users
  } catch {
    /* 忽略：离线时保持旧列表 */
  }
}

/** 向服务端上报"我已读到某会话的最新"。 */
function emitReadUpdate(key) {
  if (!state.socket?.connected) return
  if (key === 'group') state.socket.emit('read:update', { conv: 'group' })
  else if (key.startsWith('u:')) state.socket.emit('read:update', { peerId: Number(key.slice(2)) })
}

/** 切换会话：清未读 + 按需拉历史 + 上报已读。 */
export function selectConversation(key) {
  state.currentKey = key
  state.unread[key] = 0
  loadHistory(key)
  emitReadUpdate(key)
}

/** 撤回消息（自己 2 分钟内 / 管理员任意）。 */
export function recallMessage(id) {
  return new Promise((resolve, reject) => {
    state.socket.emit('message:recall', { id }, (ack) => {
      ack?.error ? reject(new Error(ack.error)) : resolve()
    })
  })
}

/** 除我之外的联系人总数（群聊"N 人已读"的分母）。 */
export const othersCount = computed(
  () => state.contacts.filter((c) => c.id !== state.user?.id).length
)

/** 群聊消息被多少其他成员读到（已读位置 >= 该消息 id 即算已读）。 */
export function groupReadCount(msg) {
  return state.contacts.reduce(
    (n, c) => n + (c.id !== state.user?.id && (state.groupReads[c.id] || 0) >= msg.id ? 1 : 0),
    0
  )
}

/** 消息是否仍可撤回：自己发的、未撤回、2 分钟内（管理员不限时）。 */
export function canRecall(msg) {
  if (!msg || msg.revoked) return false
  if (msg.senderId !== state.user?.id && !state.user?.isAdmin) return false
  if (state.user?.isAdmin) return true
  return Date.now() - new Date(msg.createdAt.replace(' ', 'T')).getTime() < 2 * 60 * 1000
}

// ---------- 桌面通知 ----------

/** 页面在后台时用系统通知提醒新消息。 */
function notifyDesktop(msg, key) {
  if (!document.hidden || msg.senderId === state.user?.id) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const body =
    msg.type === 'text' ? msg.content : msg.content?.name ? `[文件] ${msg.content.name}` : '[消息]'
  const n = new Notification(msg.senderNickname, { body, tag: `lq-${key}` })
  n.onclick = () => {
    window.focus()
    selectConversation(key)
    n.close()
  }
}

/** 请求桌面通知授权（在用户点击交互后调用，避免被浏览器拦截）。 */
export function requestNotifyPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

/** 发送文本消息。 */
export function sendText(text) {
  return new Promise((resolve, reject) => {
    const to = state.currentKey === 'group' ? null : Number(state.currentKey.slice(2))
    state.socket.emit('message:send', { to, type: 'text', content: text }, (ack) => {
      ack?.error ? reject(new Error(ack.error)) : resolve()
    })
  })
}

/** 上传并以消息发送文件：见 uploads.js 的上传队列（带进度/取消/重试）。 */

/** 拉取当前单文件上传上限（MB），供发送前预检与界面提示。 */
export async function loadUploadLimit() {
  try {
    state.maxUploadMb = (await api.uploadLimit()).maxUploadMb
  } catch { /* 离线时忽略，发送时服务端仍会兜底校验 */ }
}

/** 通知当前会话对方"正在输入"。 */
export function sendTyping() {
  const to = state.currentKey === 'group' ? null : Number(state.currentKey.slice(2))
  state.socket?.emit('typing', { to })
}

/** 登录成功：持久化凭证并建立连接。 */
export function loginSuccess(token, user) {
  state.token = token
  state.user = user
  localStorage.setItem('lq_token', token)
  localStorage.setItem('lq_user', JSON.stringify(user))
  connectSocket()
}

/** 登出/被踢：断开连接并清理本地状态。 */
export function logout(reason = '') {
  state.socket?.disconnect()
  Object.assign(state, {
    token: '',
    user: null,
    socket: null,
    connected: false,
    contacts: [],
    onlineIds: new Set(),
    currentKey: 'group',
    messages: { group: [] },
    lastMsg: {},
    loadedKeys: new Set(),
    unread: {},
    typing: {},
    readMarks: {},
    groupReads: {},
    kickReason: reason,
  })
  localStorage.removeItem('lq_token')
  localStorage.removeItem('lq_user')
}

// 页面刷新后若本地存有凭证，自动重连
if (state.token && state.user) connectSocket()
