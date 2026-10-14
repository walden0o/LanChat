<template>
  <div class="chat-page">
    <!-- 左侧：个人信息 + 会话列表 -->
    <aside class="sidebar">
      <div class="me">
        <div class="avatar">{{ avatarChar }}</div>
        <div class="me-info">
          <div class="me-name">
            {{ state.user.nickname }}
            <span v-if="state.user.isAdmin" class="badge">管理员</span>
          </div>
          <div class="me-status" :class="{ offline: !state.connected }">
            {{ state.connected ? '已连接' : '连接中…' }}
          </div>
        </div>
        <button v-if="state.user.isAdmin" class="icon-btn" title="用户管理" @click="showAdmin = true">⚙</button>
        <button class="icon-btn" title="退出登录" @click="logout()">⏻</button>
      </div>

      <ul class="conv-list">
        <li
          v-for="c in conversationList"
          :key="c.key"
          :class="{ active: c.key === state.currentKey }"
          @click="selectConversation(c.key)"
        >
          <span class="conv-dot" :class="{ on: c.online }"></span>
          <span class="conv-name">{{ c.name }}</span>
          <span v-if="c.unread" class="conv-unread">{{ c.unread > 99 ? '99+' : c.unread }}</span>
        </li>
      </ul>
    </aside>

    <!-- 右侧：消息区 + 输入区 -->
    <main class="main">
      <header class="chat-header">
        <span class="chat-title">{{ currentTitle }}</span>
        <span v-if="typingText" class="typing-hint">{{ typingText }}</span>
      </header>

      <div ref="msgBox" class="messages" @scroll="onScroll">
        <div
          v-for="m in currentMessages"
          :key="m.id"
          class="msg-row"
          :class="{ mine: m.senderId === state.user.id }"
        >
          <div class="msg-meta">{{ m.senderNickname }} · {{ formatTime(m.createdAt) }}</div>
          <div v-if="m.type === 'text'" class="bubble">{{ m.content }}</div>
          <template v-else>
            <!-- 图片/视频内联预览，其余文件显示下载卡片 -->
            <img
              v-if="isImage(m.content)"
              class="msg-img"
              :src="mediaUrl(m.content)"
              :alt="m.content.name"
              @click="previewUrl = mediaUrl(m.content)"
            />
            <video
              v-else-if="isVideo(m.content)"
              class="msg-video"
              :src="mediaUrl(m.content)"
              controls
              preload="metadata"
            ></video>
            <div
              v-else
              class="bubble file-bubble"
              @click="isText(m.content) ? openTextPreview(m.content) : downloadFile(m.content.fileId, m.content.name)"
            >
              <span class="file-icon">{{ isText(m.content) ? '📝' : '📄' }}</span>
              <span class="file-info">
                <span class="file-name">{{ m.content.name }}</span>
                <span class="file-size">
                  {{ formatSize(m.content.size) }} · {{ isText(m.content) ? '点击预览' : '点击下载' }}
                </span>
              </span>
            </div>
            <div v-if="isImage(m.content) || isVideo(m.content)" class="media-caption">
              {{ m.content.name }} · {{ formatSize(m.content.size) }} ·
              <a class="media-dl" @click="downloadFile(m.content.fileId, m.content.name)">下载</a>
            </div>
          </template>
        </div>
        <div v-if="!currentMessages.length" class="msg-empty">暂无消息，来聊第一句吧</div>
      </div>

      <footer class="input-area">
        <div class="input-toolbar">
          <button class="icon-btn" title="发送文件" :disabled="state.uploading" @click="fileInput.click()">
            {{ state.uploading ? '⏳' : '📎' }}
          </button>
          <input ref="fileInput" type="file" hidden @change="onPickFile" />
        </div>
        <textarea
          v-model="draft"
          rows="3"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          @keydown.enter.exact.prevent="send"
          @input="sendTyping"
        ></textarea>
        <button class="btn-primary send-btn" :disabled="!draft.trim()" @click="send">发送</button>
      </footer>
    </main>

    <!-- 图片大图预览灯箱 -->
    <div v-if="previewUrl" class="lightbox" @click="previewUrl = ''">
      <img :src="previewUrl" alt="图片预览" />
    </div>

    <!-- 文本文件预览弹窗 -->
    <div v-if="textPreview" class="modal-mask" @click.self="textPreview = null">
      <div class="modal text-modal">
        <div class="modal-head">
          <h3 class="text-modal-title">{{ textPreview.name }}</h3>
          <div class="text-modal-ops">
            <button class="dl-btn" @click="downloadFile(textPreview.fileId, textPreview.name)">下载</button>
            <button class="icon-btn" @click="textPreview = null">✕</button>
          </div>
        </div>
        <pre class="text-preview">{{ textPreview.text }}</pre>
      </div>
    </div>

    <AdminPanel v-if="showAdmin" @close="showAdmin = false" />
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import {
  state,
  currentMessages,
  currentTitle,
  conversationList,
  selectConversation,
  sendText,
  sendFile,
  sendTyping,
  logout,
} from '../store.js'
import { downloadFile } from '../api.js'
import AdminPanel from '../components/AdminPanel.vue'

const draft = ref('')
const showAdmin = ref(false)
const msgBox = ref(null)
const fileInput = ref(null)
const typingText = ref('')

const avatarChar = (state.user?.nickname || '?').slice(0, 1).toUpperCase()
const previewUrl = ref('')

// <img>/<video> 无法带 Authorization 头，通过 ?token= 传递凭证
const mediaUrl = (c) => `/api/files/${c.fileId}?token=${encodeURIComponent(state.token)}`
const isImage = (c) => /^image\//.test(c?.mime || '') && c.mime !== 'image/svg+xml'
const isVideo = (c) => /^video\//.test(c?.mime || '')

// 文本文件判定：mime 不可靠（.md 常是 octet-stream），扩展名做兜底
const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/toml',
  'application/x-sh',
])
const TEXT_EXT_RE =
  /\.(txt|md|log|json|js|mjs|ts|jsx|tsx|vue|css|scss|less|html?|xml|ya?ml|toml|ini|cfg|conf|env|sh|bat|py|java|c|h|cpp|hpp|cc|go|rs|rb|php|sql|csv|diff)$/i
const isText = (c) =>
  /^text\//.test(c?.mime || '') || TEXT_MIMES.has(c?.mime) || TEXT_EXT_RE.test(c?.name || '')

// 文本预览上限：超过则走 HTTP Range 只拉前 256KB
const TEXT_PREVIEW_MAX = 256 * 1024
const textPreview = ref(null)

async function openTextPreview(c) {
  textPreview.value = { name: c.name, fileId: c.fileId, text: '加载中…' }
  try {
    const truncated = c.size > TEXT_PREVIEW_MAX
    const headers = truncated ? { Range: `bytes=0-${TEXT_PREVIEW_MAX - 1}` } : {}
    const res = await fetch(mediaUrl(c), { headers })
    if (!res.ok) throw new Error()
    const buf = await res.arrayBuffer()
    // 截断处可能切坏 UTF-8 字符，去掉末尾的替换符
    let text = new TextDecoder('utf-8').decode(buf).replace(/\uFFFD+$/, '')
    if (truncated) text += `\n\n…（文件共 ${formatSize(c.size)}，仅预览前 256KB，完整内容请下载）`
    textPreview.value = { ...textPreview.value, text }
  } catch {
    textPreview.value = { ...textPreview.value, text: '预览加载失败，请尝试下载查看' }
  }
}

async function send() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  try {
    await sendText(text)
  } catch (e) {
    draft.value = text // 发送失败还原草稿
    alert(e.message)
  }
}

async function onPickFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    await sendFile(file)
  } catch (err) {
    alert(err.message)
  }
}

// 新消息到达时，若已在底部附近则自动滚到底
let stickBottom = true
function onScroll() {
  const el = msgBox.value
  stickBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
}
watch(
  () => [currentMessages.value.length, state.currentKey],
  async () => {
    await nextTick()
    if (stickBottom && msgBox.value) msgBox.value.scrollTop = msgBox.value.scrollHeight
  }
)

// "正在输入"提示：监听 store.typing 中当前会话的变化
watch(
  () => state.typing[state.currentKey],
  (nick) => {
    typingText.value = nick ? `${nick} 正在输入…` : ''
  }
)

function formatTime(s) {
  return s ? s.slice(5, 16) : ''
}
function formatSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>
