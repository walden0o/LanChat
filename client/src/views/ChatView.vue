<template>
  <div class="chat-page">
    <div v-if="sideOpen" class="side-scrim" @click="sideOpen = false"></div>

    <!-- 最左侧：QQ 窄导航栏 -->
    <NavRail
      v-model:nav-tab="navTab"
      @open-admin="showAdmin = true"
      @logout="onLogout"
    />

    <!-- 中间：浅色会话 / 联系人列表 -->
    <ChatSidebar
      :open="sideOpen"
      :nav-tab="navTab"
      @select="onSelect"
      @open-chats="navTab = 'chats'"
    />

    <!-- 右侧：消息区 + 上传队列 + 输入区（支持拖拽/粘贴文件直接发送） -->
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
          <span v-if="state.maxUploadMb" class="drop-limit">单文件上限 {{ formatLimit(state.maxUploadMb) }}</span>
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
                <span class="search-snippet" v-html="highlight(r.snippet, searchQ)"></span>
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
          <span class="msg-empty-sub">支持拖拽或 Ctrl+V 粘贴图片/文件发送</span>
        </div>

        <template v-for="(m, i) in currentMessages" :key="m.id">
          <!-- 按天分日期分隔条 -->
          <div v-if="showDate(i)" class="date-sep"><span>{{ dateLabel(m.createdAt) }}</span></div>

          <div
            class="msg-row"
            :class="{
              mine: m.senderId === state.user.id,
              grouped: isGrouped(i),
              flash: flashId === m.id,
            }"
            :data-mid="m.id"
          >
            <div
              class="msg-avatar"
              :style="{ background: avatarColor(m.senderId) }"
            >
              {{ (m.senderNickname || '?').slice(0, 1).toUpperCase() }}
            </div>

            <div class="msg-body">
              <div v-if="!isGrouped(i)" class="msg-meta">
                <span class="msg-sender">{{ m.senderNickname }}</span>
                <span class="msg-time">{{ formatTime(m.createdAt) }}</span>
              </div>

              <div v-if="m.revoked" class="bubble revoked">{{ recallText(m) }}</div>

              <div v-else class="msg-content-wrap">
                <!-- 消息悬停操作条 -->
                <div class="msg-actions">
                  <button
                    v-if="m.type === 'text'"
                    class="msg-act-btn"
                    title="复制"
                    @click="copyText(m.content)"
                  >复制</button>
                  <button
                    v-else
                    class="msg-act-btn"
                    title="下载"
                    @click="downloadFile(m.content.fileId, m.content.name)"
                  >下载</button>
                  <button
                    v-if="canRecall(m)"
                    class="msg-act-btn danger"
                    title="撤回"
                    @click="onRecall(m)"
                  >撤回</button>
                </div>

                <div v-if="m.type === 'text'" class="bubble">{{ m.content }}</div>

                <template v-else>
                  <!-- 图片/视频内联预览，其余文件显示增强文件卡片 -->
                  <img
                    v-if="isImage(m.content)"
                    class="msg-img"
                    :src="fileUrl(m.content.fileId)"
                    :alt="m.content.name"
                    @click="previewUrl = fileUrl(m.content.fileId)"
                  />
                  <video
                    v-else-if="isVideo(m.content)"
                    class="msg-video"
                    :src="fileUrl(m.content.fileId)"
                    controls
                    preload="metadata"
                  ></video>
                  <div
                    v-else
                    class="bubble file-bubble"
                    @click="isText(m.content) ? openTextPreview(m.content) : downloadFile(m.content.fileId, m.content.name)"
                  >
                    <span
                      class="file-icon-box"
                      :style="{ background: fileKind(m.content.mime, m.content.name).color + '1a' }"
                    >
                      {{ fileKind(m.content.mime, m.content.name).icon }}
                    </span>
                    <span class="file-info">
                      <span class="file-name">{{ m.content.name }}</span>
                      <span class="file-meta-row">
                        <span class="file-ext">{{ fileKind(m.content.mime, m.content.name).label }}</span>
                        <span class="file-size">{{ formatSize(m.content.size) }}</span>
                        <span class="file-hint">{{ isText(m.content) ? '点击预览' : '点击下载' }}</span>
                      </span>
                    </span>
                  </div>
                  <div v-if="isImage(m.content) || isVideo(m.content)" class="media-caption">
                    {{ m.content.name }} · {{ formatSize(m.content.size) }} ·
                    <a class="media-dl" @click="downloadFile(m.content.fileId, m.content.name)">下载</a>
                  </div>
                </template>
              </div>

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
          @click="scrollToBottom(true)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="6 13 12 19 18 13" />
          </svg>
          <span v-if="newCount" class="new-count">{{ newCount > 99 ? '99+' : newCount }}</span>
        </button>
      </transition>

      <!-- 大文件上传队列面板 -->
      <UploadQueue />

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

        <!-- QQ 经典输入区：上方工具栏 + 中间输入 + 右下角发送按钮 -->
        <div class="composer-bar">
          <button class="icon-btn" title="表情" @click="showEmoji = !showEmoji">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
          <button
            class="icon-btn"
            :title="`发送文件（支持多选，单文件上限 ${formatLimit(state.maxUploadMb)}）`"
            @click="fileInput.click()"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <input ref="fileInput" type="file" multiple hidden @change="onPickFile" />
          <span v-if="state.maxUploadMb" class="composer-limit">
            支持拖拽 / Ctrl+V 粘贴文件 · 单文件上限 {{ formatLimit(state.maxUploadMb) }}
          </span>
        </div>

        <textarea
          ref="draftInput"
          v-model="draft"
          class="composer-input"
          rows="3"
          placeholder="输入消息…"
          @keydown.enter.exact.prevent="send"
          @input="onDraftInput"
          @focus="onDraftFocus"
          @paste="onPaste"
        ></textarea>

        <div class="composer-foot">
          <span class="composer-hint">Enter 发送 · Shift+Enter 换行</span>
          <button class="send-btn" :disabled="!draft.trim()" @click="send">发送</button>
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
            <button class="icon-btn" title="关闭 (Esc)" @click="textPreview = null">✕</button>
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
  selectConversation,
  sendText,
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
import { toast } from '../toast.js'
import { api, fileUrl, downloadFile } from '../api.js'
import { enqueueFiles, cancelAllUploads } from '../uploads.js'
import {
  formatSize,
  formatLimit,
  formatTime,
  dateLabel,
  toMs,
  isImage,
  isVideo,
  isText,
  fileKind,
  highlight,
} from '../utils.js'
import AdminPanel from '../components/AdminPanel.vue'
import NavRail from '../components/NavRail.vue'
import ChatSidebar from '../components/ChatSidebar.vue'
import UploadQueue from '../components/UploadQueue.vue'

const draft = ref('')
const navTab = ref('chats')
const showAdmin = ref(false)
const showEmoji = ref(false)
const sideOpen = ref(false) // 移动端侧栏抽屉

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
  draftInput.value?.focus()
}

const msgBox = ref(null)
const fileInput = ref(null)
const draftInput = ref(null)
const searchInput = ref(null)
const typingText = ref('')
const previewUrl = ref('')

function onSelect(key) {
  selectConversation(key)
  sideOpen.value = false
}

function onLogout() {
  cancelAllUploads()
  logout()
}

// 头部副标题：群聊显示在线人数，私聊显示对方在线状态
const headerSub = computed(() => {
  if (state.currentKey === 'group') return `${state.onlineIds.size} 人在线`
  const peerId = Number(state.currentKey.slice(2))
  return state.onlineIds.has(peerId) ? '在线' : '离线'
})

// 文本预览上限：超过则走 HTTP Range 只拉前 256KB
const TEXT_PREVIEW_MAX = 256 * 1024
const textPreview = ref(null)

async function openTextPreview(c) {
  textPreview.value = { name: c.name, fileId: c.fileId, text: '加载中…' }
  try {
    const truncated = c.size > TEXT_PREVIEW_MAX
    const headers = truncated ? { Range: `bytes=0-${TEXT_PREVIEW_MAX - 1}` } : {}
    const res = await fetch(fileUrl(c.fileId), { headers })
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制到剪贴板', 'success')
  } catch {
    toast('复制失败，请手动选择文本', 'error')
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

// ---------- 文件选择 / 拖拽 / 粘贴上传 ----------
function onPickFile(e) {
  const files = [...(e.target.files || [])]
  e.target.value = ''
  sendFiles(files)
}

function onPaste(e) {
  const files = [...(e.clipboardData?.files || [])]
  if (!files.length) return
  e.preventDefault()
  sendFiles(files)
}

const dragOver = ref(false)
const hasFiles = (e) => e.dataTransfer?.types?.includes('Files')
function onDragEnter(e) { if (hasFiles(e)) dragOver.value = true }
function onDragOverEvt(e) { if (hasFiles(e)) dragOver.value = true }
function onDragLeave(e) {
  const to = e.relatedTarget
  if (!to || !e.currentTarget.contains(to)) dragOver.value = false
}
function onDrop(e) {
  dragOver.value = false
  const files = [...(e.dataTransfer?.files || [])]
  if (files.length) sendFiles(files)
}

/** 预检大小后入队上传（支持同时多选/拖入多个文件）。 */
function sendFiles(files) {
  const limitBytes = state.maxUploadMb ? state.maxUploadMb * 1024 * 1024 : 0
  const ok = []
  for (const file of files) {
    if (limitBytes && file.size > limitBytes) {
      uiAlert(`${file.name} 超过单文件上限（${formatLimit(state.maxUploadMb)}）`, { title: '无法发送' })
      continue
    }
    ok.push(file)
  }
  if (ok.length) enqueueFiles(ok)
}

// ---------- 消息滚动与分组 ----------
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

// "正在输入"提示
watch(
  () => state.typing[state.currentKey],
  (nick) => {
    typingText.value = nick ? `${nick} 正在输入…` : ''
  }
)

function showDate(i) {
  const arr = currentMessages.value
  if (i === 0) return true
  return arr[i].createdAt.slice(0, 10) !== arr[i - 1].createdAt.slice(0, 10)
}

/** 同一人 2 分钟内连续发的消息折叠头像与昵称，减少视觉重复。 */
function isGrouped(i) {
  if (i === 0 || showDate(i)) return false
  const arr = currentMessages.value
  const cur = arr[i]
  const prev = arr[i - 1]
  if (cur.senderId !== prev.senderId) return false
  return toMs(cur.createdAt) - toMs(prev.createdAt) < 2 * 60 * 1000
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
function onSearchFocus() { if (searchQ.value) onSearch() }
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

function jumpToResult(r) {
  const key = r.receiverId === null ? 'group' : `u:${r.senderId === state.user.id ? r.receiverId : r.senderId}`
  const sameKey = key === state.currentKey
  selectConversation(key)
  closeSearch()
  sideOpen.value = false
  const scrollTarget = () => {
    const row = msgBox.value?.querySelector(`[data-mid="${r.id}"]`)
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      stickBottom = false
      showScrollDown.value = true
    }
    flashMessage(r.id)
  }
  if (sameKey) nextTick(scrollTarget)
  else setTimeout(scrollTarget, 260)
}

// "/" 快速聚焦搜索框，Esc 依次关闭预览/表情/搜索
function onGlobalKey(e) {
  const tag = e.target?.tagName
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable
  if (e.key === '/' && !typing) {
    e.preventDefault()
    searchInput.value?.focus()
  } else if (e.key === 'Escape') {
    if (previewUrl.value) previewUrl.value = ''
    else if (textPreview.value) textPreview.value = null
    else if (showEmoji.value) showEmoji.value = false
    else if (searchResults.value) closeSearch()
  }
}

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
</script>
