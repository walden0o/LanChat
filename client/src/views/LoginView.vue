<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">Local QQ</h1>
      <p class="login-sub">局域网即时通讯</p>

      <div class="login-tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
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
          {{ loading ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>
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
