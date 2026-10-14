<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <h3>用户管理</h3>
        <button class="icon-btn" @click="$emit('close')">✕</button>
      </div>
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
