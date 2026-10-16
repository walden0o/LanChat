<template>
  <LoginView v-if="!state.user" />
  <ChatView v-else />
  <UiDialog />
</template>

<script setup>
import { state } from './store.js'
import LoginView from './views/LoginView.vue'
import ChatView from './views/ChatView.vue'
import UiDialog from './components/UiDialog.vue'
</script>
