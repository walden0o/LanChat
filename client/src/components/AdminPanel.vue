<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ TABS[tab] }}</h3>
        <div class="text-modal-ops">
          <button class="tab-btn" :class="{ active: tab === 'users' }" @click="tab = 'users'">用户</button>
          <button class="tab-btn" :class="{ active: tab === 'stats' }" @click="showStats">存储</button>
          <button class="tab-btn" :class="{ active: tab === 'files' }" @click="showFiles">文件</button>
          <button class="icon-btn" title="关闭 (Esc)" @click="$emit('close')">✕</button>
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
          <!-- 保留时间与上传上限设置 -->
          <div class="ttl-box">
            <div class="ttl-row">
              <label>文件保留 <input v-model.number="ttl.file" type="number" min="1" max="3650" /> 天</label>
              <label>消息保留 <input v-model.number="ttl.msg" type="number" min="1" max="3650" /> 天</label>
              <label>
                上传上限
                <input v-model.number="ttl.maxMb" class="input-wide" type="number" min="1" :max="maxCapMb" />
                MB
                <span class="limit-hint">（{{ formatLimit(ttl.maxMb) }}）</span>
              </label>
              <button class="save-btn" :disabled="savingTtl" @click="saveTtl">{{ savingTtl ? '保存中…' : '保存' }}</button>
              <button class="save-btn btn-ghost" :disabled="cleaning" @click="runCleanup">{{ cleaning ? '清理中…' : '立即清理过期' }}</button>
            </div>
            <div class="preset-row">
              <span class="preset-label">快速上限：</span>
              <button
                v-for="p in LIMIT_PRESETS"
                :key="p.mb"
                type="button"
                class="preset-btn"
                :class="{ active: ttl.maxMb === p.mb }"
                @click="ttl.maxMb = p.mb"
              >{{ p.label }}</button>
              <span v-if="ttlSaved" class="ttl-saved">✓ 已保存</span>
            </div>
          </div>

          <div class="stats-cards">
            <div class="stat-card"><b>{{ stats.messageCount }}</b><span>消息总数</span></div>
            <div class="stat-card"><b>{{ stats.fileCount }}</b><span>文件数</span></div>
            <div class="stat-card"><b>{{ formatSize(stats.fileBytes) }}</b><span>文件占用</span></div>
            <div class="stat-card"><b>{{ formatSize(stats.dbBytes) }}</b><span>数据库大小</span></div>
            <div v-if="stats.disk" class="stat-card">
              <b>{{ formatSize(stats.disk.freeBytes) }}</b>
              <span>磁盘剩余（共 {{ formatSize(stats.disk.totalBytes) }}）</span>
            </div>
          </div>

          <table class="user-table">
            <thead>
              <tr><th>用户</th><th>文件数</th><th>占用空间</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in stats.byUser" :key="u.id">
                <td>{{ u.nickname }}（{{ u.username }}）</td>
                <td>{{ u.count }}</td>
                <td>{{ formatSize(u.bytes) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-hint">正在加载统计数据…</p>
      </template>

      <!-- 文件管理：搜索 + 列表 + 删除 -->
      <template v-else>
        <div class="files-head">
          <span class="files-count">
            共 {{ filteredFiles.length }} 个文件，占用 {{ formatSize(filesSize) }}
          </span>
          <div class="files-ops">
            <input
              v-model="fileQ"
              class="file-filter"
              placeholder="筛选文件名或上传者…"
              @keydown.escape="fileQ = ''"
            />
            <button class="save-btn" :disabled="loadingFiles" @click="loadFiles">
              {{ loadingFiles ? '加载中…' : '刷新' }}
            </button>
          </div>
        </div>
        <table v-if="filteredFiles.length" class="user-table">
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
            <tr v-for="f in filteredFiles" :key="f.id">
              <td class="file-cell">
                <span class="file-badge">{{ fileKind(f.mime, f.name).icon }}</span>
                <span class="file-title">{{ f.name }}</span>
              </td>
              <td>{{ formatSize(f.size) }}</td>
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
          <span class="empty-icon">📁</span>
          {{ fileQ ? '没有匹配的文件' : '暂无上传文件' }}
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
import { toast } from '../toast.js'
import { formatSize, formatLimit, fileKind } from '../utils.js'

const emit = defineEmits(['close'])

const TABS = { users: '用户管理', stats: '存储统计', files: '文件管理' }
const LIMIT_PRESETS = [
  { label: '500 MB', mb: 500 },
  { label: '2 GB', mb: 2048 },
  { label: '10 GB', mb: 10240 },
  { label: '20 GB', mb: 20480 },
]

const users = ref([])
const error = ref('')
const tab = ref('users')
const stats = ref(null)

// 文件管理
const files = ref([])
const fileQ = ref('')
const loadingFiles = ref(false)
const filteredFiles = computed(() => {
  const q = fileQ.value.trim().toLowerCase()
  if (!q) return files.value
  return files.value.filter(
    (f) =>
      f.name.toLowerCase().includes(q) ||
      (f.uploaderNickname || '').toLowerCase().includes(q)
  )
})
const filesSize = computed(() => filteredFiles.value.reduce((sum, f) => sum + f.size, 0))

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

/** 删除文件：连带删除引用它的消息，服务端返回受影响消息数。 */
async function removeFile(f) {
  const ok = await uiConfirm(
    `确定删除文件「${f.name}」（${formatSize(f.size)}）？聊天记录中的该文件消息也会一并删除。`,
    { title: '删除文件', confirmText: '删除', danger: true }
  )
  if (!ok) return
  error.value = ''
  try {
    const r = await api.deleteFile(f.id)
    files.value = files.value.filter((x) => x.id !== f.id)
    toast(r.deletedMessages > 0 ? `已删除文件，并移除 ${r.deletedMessages} 条相关消息` : '文件已删除', 'success')
  } catch (e) {
    error.value = e.message
  }
}

// 保留时间与上传上限设置
const ttl = ref({ file: 5, msg: 5, maxMb: 20480 })
const maxCapMb = ref(20480)
const savingTtl = ref(false)
const ttlSaved = ref(false)
const cleaning = ref(false)

async function loadTtl() {
  try {
    const s = (await api.storageSettings()).settings
    ttl.value = { file: s.fileTtlDays, msg: s.messageTtlDays, maxMb: s.maxUploadMb }
    if (s.maxUploadCapMb) maxCapMb.value = s.maxUploadCapMb
  } catch { /* 忽略 */ }
}

async function saveTtl() {
  error.value = ''
  ttlSaved.value = false
  savingTtl.value = true
  try {
    const s = (
      await api.saveStorageSettings({
        fileTtlDays: ttl.value.file,
        messageTtlDays: ttl.value.msg,
        maxUploadMb: ttl.value.maxMb,
      })
    ).settings
    ttl.value = { file: s.fileTtlDays, msg: s.messageTtlDays, maxMb: s.maxUploadMb }
    state.maxUploadMb = s.maxUploadMb
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
