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
  loadedKeys: new Set(),     // 已拉取过历史的会话
  unread: {},                // 会话 key -> 未读数
  typing: {},                // 会话 key -> 正在输入的昵称
  kickReason: '',
  uploading: false,
})

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

/** 侧边栏会话列表：群聊置顶，其余联系人按在线优先排序。 */
export const conversationList = computed(() => {
  const peers = state.contacts
    .filter((c) => c.id !== state.user?.id)
    .map((c) => ({
      key: `u:${c.id}`,
      name: c.nickname,
      online: state.onlineIds.has(c.id),
      unread: state.unread[`u:${c.id}`] || 0,
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  return [
    { key: 'group', name: '群聊', online: true, unread: state.unread.group || 0 },
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
    loadHistory(state.currentKey)
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
    if (key !== state.currentKey && msg.senderId !== state.user.id) {
      state.unread[key] = (state.unread[key] || 0) + 1
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

/** 切换会话：清未读 + 按需拉历史。 */
export function selectConversation(key) {
  state.currentKey = key
  state.unread[key] = 0
  loadHistory(key)
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

/** 上传文件并作为消息发送。 */
export async function sendFile(file) {
  state.uploading = true
  try {
    const meta = await api.uploadFile(file)
    await new Promise((resolve, reject) => {
      const to = state.currentKey === 'group' ? null : Number(state.currentKey.slice(2))
      state.socket.emit('message:send', { to, type: 'file', content: meta }, (ack) => {
        ack?.error ? reject(new Error(ack.error)) : resolve()
      })
    })
  } finally {
    state.uploading = false
  }
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
    loadedKeys: new Set(),
    unread: {},
    typing: {},
    kickReason: reason,
  })
  localStorage.removeItem('lq_token')
  localStorage.removeItem('lq_user')
}

// 页面刷新后若本地存有凭证，自动重连
if (state.token && state.user) connectSocket()
