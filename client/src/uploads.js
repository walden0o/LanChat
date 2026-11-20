/**
 * 文件上传队列：逐个上传，实时进度 / 速度 / 剩余时间，可取消、可重试。
 * 目标会话在入队时锁定——上传期间切换会话不会把文件发错地方。
 */
import { reactive, computed } from 'vue'
import { state } from './store.js'
import { uploadFile } from './api.js'
import { toast } from './toast.js'

/**
 * @typedef {object} UploadTask
 * @property {number} id
 * @property {File} file
 * @property {string} name
 * @property {number} size
 * @property {number} loaded
 * @property {number} speed 字节/秒（指数平滑）
 * @property {'queued'|'uploading'|'sending'|'done'|'error'} status
 * @property {string} error
 * @property {string} convKey 入队时的会话
 * @property {AbortController|null} ctrl
 */

/** @type {UploadTask[]} */
export const uploads = reactive([])
let seq = 0
let running = false

/** 是否有未完成的上传（用于离开页面前提示）。 */
export const hasActiveUploads = computed(() =>
  uploads.some((t) => t.status === 'queued' || t.status === 'uploading' || t.status === 'sending')
)

/** 入队一批文件，目标为当前会话。 */
export function enqueueFiles(files) {
  for (const file of files) {
    uploads.push({
      id: ++seq,
      file,
      name: file.name || '未命名文件',
      size: file.size,
      loaded: 0,
      speed: 0,
      status: 'queued',
      error: '',
      convKey: state.currentKey,
      ctrl: null,
    })
  }
  pump()
}

/** 取消：排队中直接移除，上传中中断请求。 */
export function cancelUpload(id) {
  const t = uploads.find((x) => x.id === id)
  if (!t) return
  if (t.status === 'uploading') t.ctrl?.abort()
  else removeTask(id)
}

/** 失败后重试。 */
export function retryUpload(id) {
  const t = uploads.find((x) => x.id === id)
  if (!t || t.status !== 'error') return
  Object.assign(t, { status: 'queued', error: '', loaded: 0, speed: 0 })
  pump()
}

export function removeTask(id) {
  const i = uploads.findIndex((x) => x.id === id)
  if (i >= 0) uploads.splice(i, 1)
}

/** 全部取消并清空（登出时调用）。 */
export function cancelAllUploads() {
  for (const t of uploads) t.ctrl?.abort()
  uploads.splice(0)
}

/** 串行处理队列：大文件并发上传只会互相抢带宽，串行反而每个都更快完成。 */
async function pump() {
  if (running) return
  running = true
  try {
    let t
    while ((t = uploads.find((x) => x.status === 'queued'))) {
      await runTask(t)
    }
  } finally {
    running = false
  }
}

async function runTask(t) {
  t.status = 'uploading'
  t.ctrl = new AbortController()
  let lastAt = performance.now()
  let lastLoaded = 0
  try {
    const meta = await uploadFile(t.file, {
      signal: t.ctrl.signal,
      onProgress(loaded) {
        const now = performance.now()
        const dt = (now - lastAt) / 1000
        if (dt >= 0.25) {
          const inst = (loaded - lastLoaded) / dt
          t.speed = t.speed ? t.speed * 0.7 + inst * 0.3 : inst
          lastAt = now
          lastLoaded = loaded
        }
        t.loaded = loaded
      },
    })
    t.status = 'sending'
    await sendFileMessage(t.convKey, meta)
    t.status = 'done'
    t.loaded = t.size
    setTimeout(() => removeTask(t.id), 1200)
  } catch (err) {
    if (err.name === 'AbortError') {
      removeTask(t.id)
      toast(`已取消上传：${t.name}`)
    } else {
      t.status = 'error'
      t.error = err.message || '上传失败'
    }
  } finally {
    t.ctrl = null
  }
}

/** 文件已落盘后，以消息形式发到指定会话。 */
function sendFileMessage(convKey, meta) {
  return new Promise((resolve, reject) => {
    if (!state.socket?.connected) return reject(new Error('连接已断开，请重连后重试'))
    const to = convKey === 'group' ? null : Number(convKey.slice(2))
    state.socket.emit('message:send', { to, type: 'file', content: meta }, (ack) => {
      ack?.error ? reject(new Error(ack.error)) : resolve()
    })
  })
}

// 上传未完成时关闭/刷新页面：浏览器弹出离开确认
window.addEventListener('beforeunload', (e) => {
  if (hasActiveUploads.value) {
    e.preventDefault()
    e.returnValue = ''
  }
})
