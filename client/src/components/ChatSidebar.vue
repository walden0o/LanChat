<template>
  <aside class="sidebar" :class="{ open }">
    <!-- 顶部搜索栏（QQ NT 浅色极简风） -->
    <div class="side-head">
      <div class="side-search-wrap">
        <svg class="side-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="20" y1="20" x2="16.5" y2="16.5" />
        </svg>
        <input
          v-model="convQ"
          :placeholder="navTab === 'chats' ? '搜索' : '搜索联系人'"
          @keydown.escape="convQ = ''"
        />
        <button v-if="convQ" class="side-search-clear" title="清空" @click="convQ = ''">✕</button>
      </div>
    </div>

    <!-- 消息会话列表 -->
    <ul v-if="navTab === 'chats'" class="conv-list">
      <li
        v-for="c in filteredConversations"
        :key="c.key"
        :class="{ active: c.key === state.currentKey }"
        @click="$emit('select', c.key)"
      >
        <div class="conv-avatar" :style="{ background: c.color }">
          {{ c.key === 'group' ? '群' : c.name.slice(0, 1).toUpperCase() }}
          <i v-if="c.key !== 'group'" class="conv-dot" :class="{ on: c.online }"></i>
        </div>
        <div class="conv-main">
          <div class="conv-top">
            <span class="conv-name" v-html="highlight(c.name, convQ)"></span>
            <span class="conv-time">{{ c.time }}</span>
          </div>
          <div class="conv-bottom">
            <span class="conv-preview" v-html="highlight(c.preview || '暂无消息', convQ)"></span>
            <span v-if="c.unread" class="conv-unread">{{ c.unread > 99 ? '99+' : c.unread }}</span>
          </div>
        </div>
      </li>
      <li v-if="convQ && !filteredConversations.length" class="conv-empty">没有匹配的会话</li>
    </ul>

    <!-- 联系人分组列表（在线 / 离线） -->
    <div v-else class="contacts-pane">
      <div class="contact-group-title">在线成员（{{ onlineContacts.length }}）</div>
      <ul class="conv-list compact">
        <li
          v-for="u in onlineContacts"
          :key="u.id"
          :class="{ active: `u:${u.id}` === state.currentKey }"
          @click="pickContact(u.id)"
        >
          <div class="conv-avatar" :style="{ background: avatarColor(u.id) }">
            {{ u.nickname.slice(0, 1).toUpperCase() }}
            <i class="conv-dot on"></i>
          </div>
          <div class="conv-main">
            <div class="conv-top">
              <span class="conv-name" v-html="highlight(u.nickname, convQ)"></span>
              <span class="contact-tag online">在线</span>
            </div>
          </div>
        </li>
      </ul>

      <template v-if="offlineContacts.length">
        <div class="contact-group-title">离线成员（{{ offlineContacts.length }}）</div>
        <ul class="conv-list compact">
          <li
            v-for="u in offlineContacts"
            :key="u.id"
            :class="{ active: `u:${u.id}` === state.currentKey }"
            @click="pickContact(u.id)"
          >
            <div class="conv-avatar offline" :style="{ background: avatarColor(u.id) }">
              {{ u.nickname.slice(0, 1).toUpperCase() }}
              <i class="conv-dot"></i>
            </div>
            <div class="conv-main">
              <div class="conv-top">
                <span class="conv-name" v-html="highlight(u.nickname, convQ)"></span>
                <span class="contact-tag">离线</span>
              </div>
            </div>
          </li>
        </ul>
      </template>

      <div v-if="convQ && !onlineContacts.length && !offlineContacts.length" class="conv-empty">
        没有匹配的联系人
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue'
import { state, conversationList, avatarColor } from '../store.js'
import { highlight } from '../utils.js'

defineProps({
  open: { type: Boolean, default: false },
  navTab: { type: String, default: 'chats' },
})
const emit = defineEmits(['select', 'open-chats'])

const convQ = ref('')

const filteredConversations = computed(() => {
  const q = convQ.value.trim().toLowerCase()
  if (!q) return conversationList.value
  return conversationList.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.preview || '').toLowerCase().includes(q)
  )
})

const filteredContacts = computed(() => {
  const q = convQ.value.trim().toLowerCase()
  return state.contacts.filter((u) => !q || u.nickname.toLowerCase().includes(q))
})

const onlineContacts = computed(() =>
  filteredContacts.value.filter((u) => state.onlineIds.has(u.id) || u.id === state.user?.id)
)
const offlineContacts = computed(() =>
  filteredContacts.value.filter((u) => !state.onlineIds.has(u.id) && u.id !== state.user?.id)
)

function pickContact(id) {
  emit('select', `u:${id}`)
  emit('open-chats')
}
</script>
