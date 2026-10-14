<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ tab === 'users' ? '用户管理' : '存储统计' }}</h3>
        <div class="text-modal-ops">
          <button class="tab-btn" :class="{ active: tab === 'users' }" @click="tab = 'users'">用户</button>
          <button class="tab-btn" :class="{ active: tab === 'stats' }" @click="showStats">存储</button>
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

      <template v-else>
        <div v-if="stats" class="stats-panel">
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
        <p v-else class="form-error">加载中…</p>
      </template>

      <p v-if="error" class="form-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api.js'
import { state } from '../store.js'

const users = ref([])
const error = ref('')
const tab = ref('users')
const stats = ref(null)

async function showStats() {
  tab.value = 'stats'
  try {
    stats.value = (await api.stats()).stats
  } catch (e) {
    error.value = e.message
  }
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
  if (!confirm(`确定删除用户「${u.nickname}（${u.username}）」？其历史消息也会一并删除。`)) return
  await act(() => api.deleteUser(u.id))
}

onMounted(refresh)
</script>
