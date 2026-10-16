<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ TABS[tab] }}</h3>
        <div class="text-modal-ops">
          <button class="tab-btn" :class="{ active: tab === 'users' }" @click="tab = 'users'">用户</button>
          <button class="tab-btn" :class="{ active: tab === 'stats' }" @click="showStats">存储</button>
          <button class="tab-btn" :class="{ active: tab === 'files' }" @click="showFiles">文件</button>
          <button class="icon-btn" @click="$emit('close')">✕</button>
        </div>
      </div>

      <template v-if="tab === 'users'">
      <table class="user-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>昵称</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.username }}</td>
            <td>{{ u.nickname }}</td>
            <td>{{ u.is_admin ? '管理员' : '成员' }}</td>
            <td :class="{ 'text-danger': u.is_disabled }">{{ u.is_disabled ? '已禁用' : '正常' }}</td>
            <td>{{ u.created_at }}</td>
            <td class="ops">
              <template v-if="u.id !== state.user.id">
                <button @click="act(() => api.toggleDisabled(u.id))">
                  {{ u.is_disabled ? '启用' : '禁用' }}
                </button>
                <button @click="act(() => api.toggleAdmin(u.id))">
                  {{ u.is_admin ? '取消管理员' : '设为管理员' }}
                </button>
                <button class="btn-danger" @click="removeUser(u)">删除</button>
              </template>
              <span v-else class="self-tag">（我）</span>
            </td>
          </tr>
        </tbody>
      </table>
      </template>

      <template v-else-if="tab === 'stats'">
        <div v-if="stats" class="stats-panel">
          <!-- 保留时间设置 -->
          <div class="ttl-row">
            <label>文件保留 <input v-model.number="ttl.file" type="number" min="1" max="3650" /> 天</label>
            <label>消息保留 <input v-model.number="ttl.msg" type="number" min="1" max="3650" /> 天</label>
            <label>上传上限 <input v-model.number="ttl.maxMb" type="number" min="1" max="2048" /> MB</label>
            <button class="save-btn" :disabled="savingTtl" @click="saveTtl">{{ savingTtl ? '保存中…' : '保存' }}</button>
            <button class="save-btn" :disabled="cleaning" @click="runCleanup">{{ cleaning ? '清理中…' : '立即清理过期' }}</button>
            <span v-if="ttlSaved" class="ttl-saved">✓ 已保存，每小时自动清理时生效</span>
          </div>
          <div class="stats-cards">
            <div class="stat-card"><b>{{ stats.messageCount }}</b><span>消息总数</span></div>
            <div class="stat-card"><b>{{ stats.fileCount }}</b><span>文件数</span></div>
            <div class="stat-card"><b>{{ fmtSize(stats.fileBytes) }}</b><span>文件占用</span></div>
            <div class="stat-card"><b>{{ fmtSize(stats.dbBytes) }}</b><span>数据库大小</span></div>
          </div>
          <table class="user-table">
            <thead>
              <tr><th>用户</th><th>文件数</th><th>占用空间</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in stats.byUser" :key="u.id">
                <td>{{ u.nickname }}（{{ u.username }}）</td>
                <td>{{ u.count }}</td>
                <td>{{ fmtSize(u.bytes) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-hint">正在加载统计数据…</p>
      </template>

      <!-- 文件管理：列表 + 删除 -->
      <template v-else>
        <div class="files-head">
          <span class="files-count">
            共 {{ files.length }} 个文件，占用 {{ fmtSize(filesSize) }}
          </span>
          <button class="save-btn" :disabled="loadingFiles" @click="loadFiles">
            {{ loadingFiles ? '加载中…' : '刷新' }}
          </button>
        </div>
        <table v-if="files.length" class="user-table">
          <thead>
            <tr>
              <th>文件名</th>
              <th>大小</th>
              <th>上传者</th>
              <th>上传时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in files" :key="f.id">
              <td class="file-cell">
                <span class="file-badge">{{ fileIcon(f.mime) }}</span>
                <span class="file-title">{{ f.name }}</span>
              </td>
              <td>{{ fmtSize(f.size) }}</td>
              <td>{{ f.uploaderNickname }}</td>
              <td>{{ f.createdAt.slice(5, 16) }}</td>
              <td class="ops">
                <button @click="downloadFile(f.id, f.name)">下载</button>
                <button class="btn-danger" @click="removeFile(f)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!loadingFiles" class="empty-hint">
          <div class="empty-icon">📁</div>
          暂无上传文件
        </div>
      </template>

      <p v-if="error" class="form-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api, downloadFile } from '../api.js'
import { uiConfirm, uiAlert } from '../dialog.js'
import { state } from '../store.js'

const emit = defineEmits(['close'])

const TABS = { users: '用户管理', stats: '存储统计', files: '文件管理' }

const users = ref([])
const error = ref('')
const tab = ref('users')
const stats = ref(null)

// 文件管理
const files = ref([])
const loadingFiles = ref(false)
const filesSize = computed(() => files.value.reduce((sum, f) => sum + f.size, 0))

async function showFiles() {
  tab.value = 'files'
  await loadFiles()
}

async function loadFiles() {
  error.value = ''
  loadingFiles.value = true
  try {
    files.value = (await api.files(500)).files
  } catch (e) {
    error.value = e.message
  } finally {
    loadingFiles.value = false
  }
}

/** 依据 MIME 粗分文件类型，仅用于列表图标显示。 */
function fileIcon(mime = '') {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) return '📝'
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) return '🗜️'
  if (mime.includes('pdf')) return '📕'
  if (mime.includes('word') || mime.includes('document')) return '📄'
  if (mime.includes('sheet') || mime.includes('excel')) return '📗'
  return '📎'
}

/** 删除文件：连带删除引用它的消息，服务端返回受影响消息数。 */
async function removeFile(f) {
  const ok = await uiConfirm(
    `确定删除文件「${f.name}」（${fmtSize(f.size)}）？聊天记录中的该文件消息也会一并删除。`,
    { title: '删除文件', confirmText: '删除', danger: true }
  )
  if (!ok) return
  error.value = ''
  try {
    const r = await api.deleteFile(f.id)
    files.value = files.value.filter((x) => x.id !== f.id)
    if (r.deletedMessages > 0) {
      await uiAlert(`已删除文件，同时移除 ${r.deletedMessages} 条相关消息。`)
    }
  } catch (e) {
    error.value = e.message
  }
}

// 保留时间设置
const ttl = ref({ file: 5, msg: 5, maxMb: 500 })
const savingTtl = ref(false)
const ttlSaved = ref(false)
const cleaning = ref(false)

async function loadTtl() {
  try {
    const s = (await api.storageSettings()).settings
    ttl.value = { file: s.fileTtlDays, msg: s.messageTtlDays, maxMb: s.maxUploadMb }
  } catch { /* 忽略 */ }
}

async function saveTtl() {
  error.value = ''
  ttlSaved.value = false
  savingTtl.value = true
  try {
    const s = (await api.saveStorageSettings({ fileTtlDays: ttl.value.file, messageTtlDays: ttl.value.msg, maxUploadMb: ttl.value.maxMb })).settings
    ttl.value = { file: s.fileTtlDays, msg: s.messageTtlDays, maxMb: s.maxUploadMb }
    ttlSaved.value = true
    setTimeout(() => (ttlSaved.value = false), 4000)
  } catch (e) {
    error.value = e.message
  } finally {
    savingTtl.value = false
  }
}

/** 手动触发一轮过期清理，弹结果。 */
async function runCleanup() {
  error.value = ''
  cleaning.value = true
  try {
    const r = (await api.runCleanup()).result
    await uiAlert(`清理完成：消息 ${r.messages} 条、文件 ${r.files} 个（磁盘 ${r.unlinked}）、死文件消息 ${r.orphanFileMessages} 条`)
    await showStats()
  } catch (e) {
    error.value = e.message
  } finally {
    cleaning.value = false
  }
}

async function showStats() {
  tab.value = 'stats'
  try {
    stats.value = (await api.stats()).stats
  } catch (e) {
    error.value = e.message
  }
  loadTtl()
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function refresh() {
  try {
    users.value = (await api.users()).users
  } catch (e) {
    error.value = e.message
  }
}

/** 执行操作并刷新列表。 */
async function act(fn) {
  error.value = ''
  try {
    await fn()
    await refresh()
  } catch (e) {
    error.value = e.message
  }
}

async function removeUser(u) {
  const ok = await uiConfirm(
    `确定删除用户「${u.nickname}（${u.username}）」？其历史消息也会一并删除。`,
    { title: '删除用户', confirmText: '删除', danger: true }
  )
  if (!ok) return
  await act(() => api.deleteUser(u.id))
}

// Esc 关闭弹窗
function onKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  refresh()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
