<template>
  <div class="chat-page">
    <div v-if="sideOpen" class="side-scrim" @click="sideOpen = false"></div>
    <!-- 左侧：个人信息 + 会话列表 -->
    <aside class="sidebar" :class="{ open: sideOpen }">
      <div class="me">
        <div class="avatar" :style="{ background: avatarColor(state.user.id) }">{{ avatarChar }}</div>
        <div class="me-info">
          <div class="me-name">
            {{ state.user.nickname }}
            <span v-if="state.user.isAdmin" class="badge">管理员</span>
          </div>
          <div class="me-status" :class="{ offline: !state.connected }">
            <i class="status-dot"></i>{{ state.connected ? '在线' : '连接中…' }}
          </div>
        </div>
        <button v-if="state.user.isAdmin" class="icon-btn" title="用户管理" @click="showAdmin = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button class="icon-btn" title="退出登录" @click="logout()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v8" />
            <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
          </svg>
        </button>
      </div>

      <div class="side-search">
        <div class="side-search-wrap">
          <input
            v-model="convQ"
            placeholder="搜索会话…"
            @keydown.escape="convQ = ''"
          />
          <button v-if="convQ" class="side-search-clear" title="清空" @click="convQ = ''">✕</button>
        </div>
      </div>

      <ul class="conv-list">
        <li
          v-for="c in filteredConversations"
          :key="c.key"
          :class="{ active: c.key === state.currentKey }"
          @click="onSelect(c.key)"
        >
          <div class="conv-avatar" :style="{ background: c.color }">
            {{ c.name.slice(0, 1).toUpperCase() }}
            <i class="conv-dot" :class="{ on: c.online }"></i>
          </div>
          <div class="conv-main">
            <div class="conv-top">
              <span class="conv-name" v-html="highlight(c.name)"></span>
              <span class="conv-time">{{ c.time }}</span>
            </div>
            <div class="conv-bottom">
              <span class="conv-preview" v-html="highlight(c.preview || '暂无消息')"></span>
              <span v-if="c.unread" class="conv-unread">{{ c.unread > 99 ? '99+' : c.unread }}</span>
            </div>
          </div>
        </li>
        <li v-if="convQ && !filteredConversations.length" class="conv-empty">没有匹配的会话</li>
      </ul>
    </aside>

    <!-- 右侧：消息区 + 输入区（支持拖拽文件到此处直接发送） -->
    <main
      class="main"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOverEvt"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- 拖拽悬浮提示层 -->
      <div v-if="dragOver" class="drop-overlay">
        <div class="drop-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p>松开鼠标，发送到{{ state.currentKey === 'group' ? '群聊' : '当前会话' }}</p>
        </div>
      </div>
      <header class="chat-header">
        <button class="icon-btn side-toggle" title="会话列表" @click="sideOpen = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="15" y2="12" />
            <line x1="3" y1="18" x2="18" y2="18" />
          </svg>
        </button>
        <div class="chat-head-main">
          <span class="chat-title">{{ currentTitle }}</span>
          <span class="chat-sub">{{ headerSub }}</span>
          <span v-if="typingText" class="typing-hint">{{ typingText }}</span>
        </div>
        <!-- 全局消息搜索 -->
        <div class="search-box">
          <div class="search-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.5" y2="16.5" />
            </svg>
            <input
              ref="searchInput"
              v-model="searchQ"
              class="search-input"
              placeholder="搜索消息…"
              @input="onSearch"
              @focus="onSearchFocus"
              @keydown.down.prevent="moveSearch(1)"
              @keydown.up.prevent="moveSearch(-1)"
              @keydown.enter.prevent="enterSearch"
              @keydown.escape="closeSearch"
            />
            <button
              v-if="searchQ"
              class="search-clear"
              title="清空"
              @click="closeSearch"
            >✕</button>
            <span v-else class="search-kbd">/</span>
          </div>
          <div v-if="searchQ && searchResults" class="search-results" @mouseleave="searchIdx = -1">
            <div v-if="!searchResults.length" class="search-empty">无匹配消息</div>
            <template v-else>
              <div class="search-head">共 {{ searchResults.length }} 条结果 · ↑↓ 选择 · Enter 跳转</div>
              <div
                v-for="(r, ri) in searchResults"
                :key="r.id"
                class="search-item"
                :class="{ 'kbd-active': ri === searchIdx }"
                @mouseenter="searchIdx = ri"
                @click="jumpToResult(r)"
              >
                <span class="search-meta">{{ r.senderNickname }} · {{ r.createdAt.slice(5, 16) }}</span>
                <span class="search-snippet" v-html="highlight(r.snippet)"></span>
              </div>
            </template>
          </div>
        </div>
      </header>

      <div v-if="!state.connected" class="conn-banner">连接已断开，正在自动重连…</div>

      <div ref="msgBox" class="messages" @scroll="onScroll">
        <div v-if="!currentMessages.length" class="msg-empty">
          <div class="msg-empty-icon">💬</div>
          <p>暂无消息，来聊第一句吧</p>
        </div>
        <template v-for="(m, i) in currentMessages" :key="m.id">
          <!-- 按天分日期分隔条 -->
          <div v-if="showDate(i)" class="date-sep"><span>{{ dateLabel(m.createdAt) }}</span></div>
          <div
            class="msg-row"
            :class="{ mine: m.senderId === state.user.id, flash: flashId === m.id }"
            :data-mid="m.id"
          >
            <div class="msg-avatar" :style="{ background: avatarColor(m.senderId) }">
              {{ (m.senderNickname || '?').slice(0, 1).toUpperCase() }}
            </div>
            <div class="msg-body">
              <div class="msg-meta">
                {{ m.senderNickname }} · {{ formatTime(m.createdAt) }}
                <button
                  v-if="canRecall(m)"
                  class="recall-btn"
                  title="撤回"
                  @click="onRecall(m)"
                >撤回</button>
              </div>
              <div v-if="m.revoked" class="bubble revoked">{{ recallText(m) }}</div>
              <template v-else>
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
              </template>
              <!-- 私聊已读回执：只标在自己发出的最后一条消息上 -->
              <div
                v-if="isPrivate && m.senderId === state.user.id && m.id === lastOwnId"
                class="read-mark"
                :class="{ read: isRead(m) }"
              >
                {{ isRead(m) ? '已读' : '未读' }}
              </div>
              <!-- 群聊：自己每条消息下方显示已读人数 -->
              <div
                v-else-if="!isPrivate && m.senderId === state.user.id && !m.revoked && othersCount > 0"
                class="read-mark"
                :class="{ read: groupReadCount(m) >= othersCount }"
              >
                {{ groupReadCount(m) >= othersCount ? '全部已读' : `${groupReadCount(m)} 人已读` }}
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 不在底部时悬浮：回到底部 + 新消息计数 -->
      <transition name="fade">
        <button
          v-if="showScrollDown"
          class="scroll-down"
          title="回到最新消息"
          @click="scrollToBottom()"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="6 13 12 19 18 13" />
          </svg>
          <span v-if="newCount" class="new-count">{{ newCount > 99 ? '99+' : newCount }}</span>
        </button>
      </transition>

      <footer class="input-area">
        <!-- 表情选择面板 -->
        <div v-if="showEmoji" class="emoji-mask" @click="showEmoji = false"></div>
        <div v-if="showEmoji" class="emoji-panel">
          <button
            v-for="e in EMOJIS"
            :key="e"
            class="emoji-item"
            type="button"
            @click="insertEmoji(e)"
          >{{ e }}</button>
        </div>
        <div class="input-row">
          <div class="input-toolbar">
            <button class="icon-btn" title="发送文件" :disabled="state.uploading" @click="fileInput.click()">
              {{ state.uploading ? '⏳' : '📎' }}
            </button>
            <button class="icon-btn" title="表情" @click="showEmoji = !showEmoji">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </button>
            <input ref="fileInput" type="file" hidden @change="onPickFile" />
          </div>
          <textarea
            ref="draftInput"
            v-model="draft"
            rows="1"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            @keydown.enter.exact.prevent="send"
            @input="onDraftInput"
            @focus="onDraftFocus"
          ></textarea>
          <button class="send-btn" :disabled="!draft.trim()" @click="send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span class="send-label">发送</span>
          </button>
        </div>
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
import { ref, watch, nextTick, computed, onMounted, onBeforeUnmount } from 'vue'
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
  recallMessage,
  canRecall,
  requestNotifyPermission,
  avatarColor,
  groupReadCount,
  othersCount,
} from '../store.js'
import { uiConfirm, uiAlert } from '../dialog.js'
import { api, downloadFile } from '../api.js'
import AdminPanel from '../components/AdminPanel.vue'

const draft = ref('')
const showAdmin = ref(false)
const showEmoji = ref(false)
const sideOpen = ref(false) // 移动端侧栏抽屉
const convQ = ref('')

// 常用表情（纯文本插入，无需后端支持）
const EMOJIS = [
  '😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😴',
  '😭','😡','🥳','🤝','👍','👎','👌','✊','🙏','💪',
  '🎉','🔥','❤️','💔','✅','❌','⚠️','💡','☕','🍚',
  '🚀','🐱','🐶','🌹','🌈','☀️','🌧️','⚡','🎁','📌',
]
function insertEmoji(e) {
  draft.value += e
  showEmoji.value = false
}
const msgBox = ref(null)
const fileInput = ref(null)
const draftInput = ref(null)
const searchInput = ref(null)
const typingText = ref('')

// ---------- 会话列表本地筛选 ----------
function onSelect(key) {
  selectConversation(key)
  sideOpen.value = false
}

const filteredConversations = computed(() => {
  const q = convQ.value.trim().toLowerCase()
  if (!q) return conversationList.value
  return conversationList.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.preview || '').toLowerCase().includes(q)
  )
})

/** 转义 HTML 后再包 <mark>，避免 v-html 注入。 */
function highlight(text) {
  const raw = String(text ?? '')
  const q = (convQ.value.trim() || searchQ.value.trim()) || ''
  const safe = raw.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  if (!q) return safe
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safe.replace(new RegExp(esc, 'gi'), (m) => `<mark>${m}</mark>`)
}

const avatarChar = (state.user?.nickname || '?').slice(0, 1).toUpperCase()
const previewUrl = ref('')

// 头部副标题：群聊显示在线人数，私聊显示对方在线状态
const headerSub = computed(() => {
  if (state.currentKey === 'group') return `${state.onlineIds.size} 人在线`
  const peerId = Number(state.currentKey.slice(2))
  return state.onlineIds.has(peerId) ? '在线' : '离线'
})

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
  showEmoji.value = false
  autoGrow()
  try {
    await sendText(text)
  } catch (e) {
    draft.value = text // 发送失败还原草稿
    autoGrow()
    uiAlert(e.message, { title: '发送失败' })
  }
}

// ---------- 输入框自适应高度 ----------
function autoGrow() {
  const el = draftInput.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 168)}px`
}
function onDraftInput() {
  autoGrow()
  sendTyping()
}
function onDraftFocus() {
  autoGrow()
}

async function onPickFile(e) {
  const files = [...(e.target.files || [])]
  e.target.value = ''
  await sendFiles(files)
}

// ---------- 文件拖拽上传 ----------
// dragleave 在经过子元素时会频繁触发，用"离开目标是否仍在容器内"判断真离开
const dragOver = ref(false)
const hasFiles = (e) => e.dataTransfer?.types?.includes('Files')

function onDragEnter(e) {
  if (hasFiles(e)) dragOver.value = true
}
function onDragOverEvt(e) {
  if (hasFiles(e)) dragOver.value = true
}
function onDragLeave(e) {
  const to = e.relatedTarget
  if (!to || !e.currentTarget.contains(to)) dragOver.value = false
}
async function onDrop(e) {
  dragOver.value = false
  const files = [...(e.dataTransfer?.files || [])]
  if (files.length) await sendFiles(files)
}

/** 逐个上传并发送（支持一次拖入多个文件）。 */
async function sendFiles(files) {
  for (const file of files) {
    try {
      await sendFile(file)
    } catch (err) {
      uiAlert(`${file.name}：${err.message}`, { title: '上传失败' })
      break
    }
  }
}

// 新消息到达时，若已在底部附近则自动滚到底
let stickBottom = true
const showScrollDown = ref(false)
const newCount = ref(0)

function scrollToBottom(smooth = false) {
  const el = msgBox.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  stickBottom = true
  showScrollDown.value = false
  newCount.value = 0
}

function onScroll() {
  const el = msgBox.value
  if (!el) return
  stickBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  showScrollDown.value = !stickBottom
  if (stickBottom) newCount.value = 0
}
watch(
  () => [currentMessages.value.length, state.currentKey],
  async ([len], [prevLen]) => {
    await nextTick()
    if (stickBottom) {
      if (msgBox.value) msgBox.value.scrollTop = msgBox.value.scrollHeight
      newCount.value = 0
    } else if (len > (prevLen ?? 0)) {
      newCount.value += 1
    }
  }
)
// 切换会话时重置：直接贴底
watch(
  () => state.currentKey,
  async () => {
    stickBottom = true
    newCount.value = 0
    showScrollDown.value = false
    await nextTick()
    if (msgBox.value) msgBox.value.scrollTop = msgBox.value.scrollHeight
  }
)

// "正在输入"提示：监听 store.typing 中当前会话的变化
watch(
  () => state.typing[state.currentKey],
  (nick) => {
    typingText.value = nick ? `${nick} 正在输入…` : ''
  }
)

// ---------- 日期分隔 ----------
function showDate(i) {
  const arr = currentMessages.value
  if (i === 0) return true
  return arr[i].createdAt.slice(0, 10) !== arr[i - 1].createdAt.slice(0, 10)
}
function dateLabel(s) {
  const day = s.slice(0, 10)
  const today = new Date().toLocaleDateString('sv')
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('sv')
  if (day === today) return '今天'
  if (day === yesterday) return '昨天'
  return day
}
function formatTime(s) {
  if (!s) return ''
  const today = new Date().toLocaleDateString('sv')
  return s.slice(0, 10) === today ? s.slice(11, 16) : s.slice(5, 16)
}

// ---------- 撤回 ----------
async function onRecall(m) {
  const ok = await uiConfirm('确定撤回这条消息？', { title: '撤回消息', confirmText: '撤回', danger: true })
  if (!ok) return
  try {
    await recallMessage(m.id)
  } catch (e) {
    uiAlert(e.message, { title: '撤回失败' })
  }
}
const recallText = (m) => (m.senderId === state.user.id ? '你撤回了一条消息' : `${m.senderNickname} 撤回了一条消息`)

// ---------- 已读回执（仅私聊） ----------
const isPrivate = computed(() => state.currentKey.startsWith('u:'))
const lastOwnId = computed(() => {
  const list = currentMessages.value
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].senderId === state.user.id) return list[i].id
  }
  return 0
})
const isRead = (m) => m.id <= (state.readMarks[state.currentKey] || 0)

// ---------- 消息搜索 ----------
const searchQ = ref('')
const searchResults = ref(null)
const searchIdx = ref(-1)
let searchTimer = null
function onSearch() {
  clearTimeout(searchTimer)
  searchIdx.value = -1
  if (!searchQ.value.trim()) {
    searchResults.value = null
    return
  }
  searchTimer = setTimeout(async () => {
    try {
      const { results } = await api.search(searchQ.value.trim())
      searchResults.value = results
    } catch {
      searchResults.value = []
    }
  }, 300)
}
function onSearchFocus() {
  if (searchQ.value) onSearch()
}
function closeSearch() {
  searchQ.value = ''
  searchResults.value = null
  searchIdx.value = -1
}
function moveSearch(step) {
  const list = searchResults.value
  if (!list?.length) return
  searchIdx.value = (searchIdx.value + step + list.length) % list.length
}
function enterSearch() {
  const list = searchResults.value
  if (!list?.length) return
  jumpToResult(list[searchIdx.value >= 0 ? searchIdx.value : 0])
}

// 跳转后高亮定位到的那条消息，避免"跳过去却找不到"
const flashId = ref(0)
let flashTimer = null
function flashMessage(id) {
  flashId.value = 0
  clearTimeout(flashTimer)
  nextTick(() => {
    flashId.value = id
    flashTimer = setTimeout(() => { flashId.value = 0 }, 1500)
  })
}

/** 点击搜索结果：跳转到对应会话并高亮该消息。 */
function jumpToResult(r) {
  const key = r.receiverId === null ? 'group' : `u:${r.senderId === state.user.id ? r.receiverId : r.senderId}`
  const sameKey = key === state.currentKey
  selectConversation(key)
  closeSearch()
  sideOpen.value = false
  if (sameKey) {
    // 同会话：直接滚动到该条
    nextTick(() => {
      const row = msgBox.value?.querySelector(`[data-mid="${r.id}"]`)
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' })
        stickBottom = false
        showScrollDown.value = true
      }
      flashMessage(r.id)
    })
  } else {
    // 跨会话：等历史加载完再定位
    setTimeout(() => {
      const row = msgBox.value?.querySelector(`[data-mid="${r.id}"]`)
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' })
        stickBottom = false
        showScrollDown.value = true
      }
      flashMessage(r.id)
    }, 260)
  }
}

// "/" 快速聚焦搜索框，Esc 退出
function onGlobalKey(e) {
  const tag = e.target?.tagName
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable
  if (e.key === '/' && !typing) {
    e.preventDefault()
    searchInput.value?.focus()
  } else if (e.key === 'Escape' && searchResults.value) {
    closeSearch()
  }
}

// 用户首次交互后请求桌面通知授权（浏览器要求交互后才能弹授权框）
onMounted(() => {
  const once = () => {
    requestNotifyPermission()
    window.removeEventListener('click', once)
  }
  window.addEventListener('click', once)
  window.addEventListener('keydown', onGlobalKey)
  autoGrow()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  clearTimeout(flashTimer)
})
function formatSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>
