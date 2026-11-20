<template>
  <transition name="fade">
    <div v-if="uploads.length" class="upload-queue">
      <div
        v-for="t in uploads"
        :key="t.id"
        class="uq-item"
        :class="t.status"
      >
        <div class="uq-main">
          <div class="uq-top">
            <span class="uq-name" :title="t.name">{{ t.name }}</span>
            <span class="uq-meta">
              <template v-if="t.status === 'queued'">排队中 · {{ formatSize(t.size) }}</template>
              <template v-else-if="t.status === 'uploading'">
                {{ formatSize(t.loaded) }} / {{ formatSize(t.size) }}
                <template v-if="t.speed > 0">
                  · {{ formatSize(t.speed) }}/s · 剩余 {{ eta(t) }}
                </template>
              </template>
              <template v-else-if="t.status === 'sending'">正在发送消息…</template>
              <template v-else-if="t.status === 'done'">已发送</template>
              <template v-else-if="t.status === 'error'">{{ t.error }}</template>
            </span>
          </div>
          <div class="uq-bar">
            <div class="uq-fill" :style="{ width: pct(t) + '%' }"></div>
          </div>
        </div>
        <div class="uq-ops">
          <span v-if="t.status === 'uploading'" class="uq-pct">{{ pct(t) }}%</span>
          <button
            v-if="t.status === 'error'"
            class="uq-btn"
            title="重试"
            @click="retryUpload(t.id)"
          >重试</button>
          <button
            v-if="t.status !== 'done' && t.status !== 'sending'"
            class="uq-btn uq-close"
            :title="t.status === 'uploading' ? '取消上传' : '移除'"
            @click="cancelUpload(t.id)"
          >✕</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { uploads, cancelUpload, retryUpload } from '../uploads.js'
import { formatSize, formatDuration } from '../utils.js'

function pct(t) {
  if (t.status === 'done' || t.status === 'sending') return 100
  if (!t.size) return 0
  return Math.min(99, Math.floor((t.loaded / t.size) * 100))
}

function eta(t) {
  if (!t.speed || t.loaded >= t.size) return '—'
  return formatDuration((t.size - t.loaded) / t.speed)
}
</script>
