<template>
  <nav class="nav-rail" aria-label="主导航">
    <div class="rail-me" :title="`${state.user.nickname}（${state.connected ? '在线' : '连接中'}）`">
      <div class="rail-avatar" :style="{ background: avatarColor(state.user.id) }">
        {{ avatarChar }}
        <i class="rail-status-dot" :class="{ offline: !state.connected }"></i>
      </div>
    </div>

    <div class="rail-nav">
      <button
        class="rail-btn"
        :class="{ active: navTab === 'chats' }"
        title="消息"
        @click="$emit('update:navTab', 'chats')"
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3C6.48 3 2 6.58 2 11c0 2.4 1.33 4.55 3.43 6.02-.22 1.24-.82 2.45-1.45 3.24-.2.25.02.61.33.54 1.75-.4 3.55-1.15 4.78-1.93.92.22 1.9.33 2.91.33 5.52 0 10-3.58 10-8s-4.48-8-10-8z" />
        </svg>
        <span v-if="totalUnread" class="rail-badge">{{ totalUnread > 99 ? '99+' : totalUnread }}</span>
      </button>

      <button
        class="rail-btn"
        :class="{ active: navTab === 'contacts' }"
        title="联系人"
        @click="$emit('update:navTab', 'contacts')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </button>
    </div>

    <div class="rail-foot">
      <button
        v-if="state.user.isAdmin"
        class="rail-btn"
        title="后台管理"
        @click="$emit('open-admin')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <button class="rail-btn" title="退出登录" @click="$emit('logout')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  </nav>
</template>

<script setup>
import { computed } from 'vue'
import { state, avatarColor } from '../store.js'

defineProps({
  navTab: { type: String, default: 'chats' },
})
defineEmits(['update:navTab', 'open-admin', 'logout'])

const avatarChar = computed(() => (state.user?.nickname || '?').slice(0, 1).toUpperCase())
const totalUnread = computed(() =>
  Object.values(state.unread).reduce((sum, n) => sum + (n || 0), 0)
)
</script>
