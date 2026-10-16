<template>
  <transition name="fade">
    <div v-if="dialogState.show" class="modal-mask" @click.self="onCancel">
      <div class="mini-modal" role="dialog" aria-modal="true">
        <h4 :class="{ danger: dialogState.danger }">{{ dialogState.title }}</h4>
        <p class="mini-modal-msg">{{ dialogState.message }}</p>
        <div class="mini-modal-ops">
          <button v-if="dialogState.kind === 'confirm'" class="mini-btn" @click="onCancel">
            {{ dialogState.cancelText }}
          </button>
          <button
            class="mini-btn primary"
            :class="{ danger: dialogState.danger }"
            ref="okBtn"
            @click="onOk"
          >
            {{ dialogState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
/**
 * 全局应用内对话框（挂载于 App.vue，状态来自 dialog.js）。
 * 替代原生 confirm/alert，规避浏览器"禁止更多对话框"后的静默失效。
 */
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { dialogState, closeDialog } from '../dialog.js'

const okBtn = ref(null)

function onOk() {
  closeDialog(dialogState.kind === 'confirm')
}
function onCancel() {
  closeDialog(false)
}
function onKey(e) {
  if (!dialogState.show) return
  e.stopImmediatePropagation()
  if (e.key === 'Escape') closeDialog(false)
  else if (e.key === 'Enter') onOk()
}

watch(
  () => dialogState.show,
  async (open) => {
    if (open) {
      await nextTick()
      okBtn.value?.focus()
    }
  }
)
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
</script>
