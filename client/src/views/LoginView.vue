<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </div>
      <h1 class="login-title">Local QQ</h1>
      <p class="login-sub">局域网即时通讯</p>

      <div class="login-tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
        <i class="tab-ink" :style="{ transform: mode === 'login' ? 'translateX(0)' : 'translateX(100%)' }"></i>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <input v-model.trim="username" placeholder="用户名（字母/数字/下划线）" autocomplete="username" />
        <input
          v-model="password"
          type="password"
          placeholder="密码（至少 6 位）"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
        />
        <input
          v-if="mode === 'register'"
          v-model.trim="nickname"
          placeholder="昵称（可选，默认同用户名）"
          maxlength="32"
        />
        <p v-if="error" class="form-error">{{ error }}</p>
        <p v-if="state.kickReason" class="form-error">{{ state.kickReason }}</p>
        <button class="btn-primary" :disabled="loading">
          {{ loading ? '请稍候…' : mode === 'login' ? '登 录' : '注册并登录' }}
        </button>
      </form>
      <p class="login-tip">首个注册用户自动成为管理员</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { api } from '../api.js'
import { state, loginSuccess } from '../store.js'

const mode = ref('login')
const username = ref('')
const password = ref('')
const nickname = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  state.kickReason = ''
  loading.value = true
  try {
    const data =
      mode.value === 'login'
        ? await api.login(username.value, password.value)
        : await api.register(username.value, password.value, nickname.value)
    loginSuccess(data.token, data.user)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>
