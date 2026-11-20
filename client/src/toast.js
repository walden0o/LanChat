/**
 * 轻提示（toast）：用于"已复制""上传完成"等无需打断用户的反馈。
 * 需要用户确认的场景仍使用 dialog.js 的 uiConfirm / uiAlert。
 */
import { reactive } from 'vue'

export const toasts = reactive([])
let seq = 0

/**
 * @param {string} text
 * @param {'info'|'success'|'error'} [type]
 * @param {number} [ms] 显示时长
 */
export function toast(text, type = 'info', ms = 2600) {
  const id = ++seq
  toasts.push({ id, text, type })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, ms)
}
