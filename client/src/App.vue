<template>
  <LoginView v-if="!state.user" />
  <ChatView v-else />
</template>

<script setup>
import { state } from './store.js'
import LoginView from './views/LoginView.vue'
import ChatView from './views/ChatView.vue'
</script>
