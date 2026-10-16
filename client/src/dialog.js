/**
 * 应用内对话框：替代浏览器原生 confirm()/alert()。
 * 原生弹窗一旦被用户勾选"禁止此页面再显示对话框"就会静默失效
 * （confirm 永远返回 false），导致删除等操作"点了没反应"。
 */
import { reactive } from 'vue'

export const dialogState = reactive({
  show: false,
  kind: 'confirm', // 'confirm' | 'alert'
  title: '请确认',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
  _resolve: null,
})

/** 确认框：resolve(true/false)。danger=true 时确认按钮为红色（删除类操作）。 */
export function uiConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    Object.assign(dialogState, {
      show: true,
      kind: 'confirm',
      title: opts.title || '请确认',
      message,
      confirmText: opts.confirmText || '确定',
      cancelText: opts.cancelText || '取消',
      danger: !!opts.danger,
      _resolve: resolve,
    })
  })
}

/** 提示框：resolve()。 */
export function uiAlert(message, opts = {}) {
  return new Promise((resolve) => {
    Object.assign(dialogState, {
      show: true,
      kind: 'alert',
      title: opts.title || '提示',
      message,
      confirmText: opts.confirmText || '知道了',
      cancelText: '',
      danger: !!opts.danger,
      _resolve: resolve,
    })
  })
}

/** 由 UiDialog 组件调用：关闭并回传结果。 */
export function closeDialog(value) {
  const resolve = dialogState._resolve
  dialogState.show = false
  dialogState._resolve = null
  resolve?.(value)
}
