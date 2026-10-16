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
        <button type="button" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
        <i class="tab-ink" :style="{ transform: mode === 'login' ? 'translateX(0)' : 'translateX(100%)' }"></i>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <div class="field">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <input
            ref="userInput"
            v-model.trim="username"
            placeholder="用户名（字母/数字/下划线）"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            maxlength="32"
            :class="{ invalid: username && usernameError }"
            @blur="touched = true"
          />
        </div>
        <div class="field">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          <input
            v-model="password"
            :type="showPw ? 'text' : 'password'"
            class="with-toggle"
            placeholder="密码（至少 6 位）"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            @keyup="onKeyEvent"
            @keydown="onKeyEvent"
            :class="{ invalid: password && passwordError }"
            @blur="touched = true"
          />
          <button type="button" class="pw-toggle" :title="showPw ? '隐藏密码' : '显示密码'" @click="showPw = !showPw">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M1.5 12S5.5 5.5 12 5.5 22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12z" />
              <circle cx="12" cy="12" r="3" />
              <path v-if="showPw" d="M4 20 20 4" />
            </svg>
          </button>
        </div>
        <p v-if="capsOn" class="field-hint">⚠ 大写锁定已开启</p>
        <div v-if="mode === 'register'" class="field">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z" />
          </svg>
          <input
            v-model.trim="nickname"
            placeholder="昵称（可选，默认同用户名）"
            maxlength="32"
            :class="{ invalid: nickname && nicknameError }"
          />
        </div>
        <p v-if="error" class="form-error">{{ error }}</p>
        <p v-else-if="touched && firstError" class="form-error">{{ firstError }}</p>
        <p v-if="state.kickReason" class="form-error">{{ state.kickReason }}</p>
        <button class="btn-primary" :class="{ loading }" :disabled="loading">
          {{ loading ? '请稍候…' : mode === 'login' ? '登 录' : '注册并登录' }}
        </button>
      </form>
      <p class="login-tip">首个注册用户自动成为管理员</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { api } from '../api.js'
import { state, loginSuccess } from '../store.js'

// 与服务端 server/routes/auth.js 保持一致，避免往返一次才知道错在哪
const USERNAME_RE = /^[\w-]{2,32}$/

const mode = ref('login')
const username = ref('')
const password = ref('')
const nickname = ref('')
const error = ref('')
const loading = ref(false)
const showPw = ref(false)
const capsOn = ref(false)
const touched = ref(false)
const userInput = ref(null)

const usernameError = computed(() => {
  if (!username.value) return '请输入用户名'
  if (!USERNAME_RE.test(username.value)) return '用户名需为 2-32 位字母/数字/下划线/中划线'
  return ''
})
const passwordError = computed(() => {
  if (!password.value) return '请输入密码'
  if (password.value.length < 6) return '密码长度至少 6 位'
  if (password.value.length > 128) return '密码最长 128 位'
  return ''
})
const nicknameError = computed(() =>
  nickname.value.length > 32 ? '昵称最长 32 个字符' : ''
)
const firstError = computed(
  () => usernameError.value || passwordError.value || nicknameError.value
)
const canSubmit = computed(() => !firstError.value)

function onKeyEvent(e) {
  if (typeof e.getModifierState === 'function') {
    capsOn.value = e.getModifierState('CapsLock')
  }
}

function switchMode(m) {
  if (mode.value === m) return
  mode.value = m
  error.value = ''
  touched.value = false
  capsOn.value = false
}

async function submit() {
  touched.value = true
  error.value = ''
  if (!canSubmit.value) {
    const first = document.querySelector('.login-form input.invalid')
    if (first) first.focus()
    return
  }
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

// 自动聚焦，省一次点击
watch(
  () => state.kickReason,
  (v) => {
    if (v) error.value = ''
  }
)
nextTick(() => userInput.value?.focus())
</script>
