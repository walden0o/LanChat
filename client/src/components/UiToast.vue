<template>
  <div class="toast-stack" aria-live="polite">
    <transition-group name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast-item" :class="t.type">
        <span class="toast-dot"></span>
        <span class="toast-text">{{ t.text }}</span>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { toasts } from '../toast.js'
</script>
