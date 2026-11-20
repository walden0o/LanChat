/**
 * 通用工具：尺寸/时间格式化、文件类型判定、搜索高亮。
 * 原先散落在 ChatView / AdminPanel 中的重复实现统一收敛于此。
 */

/** 字节数 → 人类可读（B / KB / MB / GB）。 */
export function formatSize(n) {
  n = Number(n) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** 上传上限（MB）→ 文案：≥1024MB 显示为 GB。 */
export function formatLimit(mb) {
  if (!mb) return '—'
  return mb >= 1024 ? `${+(mb / 1024).toFixed(2)} GB` : `${mb} MB`
}

/** 秒数 → "1 小时 3 分" / "3 分 20 秒" / "12 秒"。 */
export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  sec = Math.round(sec)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h) return `${h} 小时 ${m} 分`
  if (m) return `${m} 分 ${s} 秒`
  return `${s} 秒`
}

/** 本地日期 YYYY-MM-DD。 */
const ymd = (d) => d.toLocaleDateString('sv')

/** 消息时间：今天只显示时分，否则月-日 时分。 */
export function formatTime(s) {
  if (!s) return ''
  return s.slice(0, 10) === ymd(new Date()) ? s.slice(11, 16) : s.slice(5, 16)
}

/** 日期分隔条文案：今天 / 昨天 / YYYY-MM-DD。 */
export function dateLabel(s) {
  const day = s.slice(0, 10)
  if (day === ymd(new Date())) return '今天'
  if (day === ymd(new Date(Date.now() - 864e5))) return '昨天'
  return day
}

/** "YYYY-MM-DD HH:MM:SS" → 毫秒时间戳。 */
export const toMs = (s) => new Date(String(s).replace(' ', 'T')).getTime()

// ---------- 文件类型 ----------

export const isImage = (c) => /^image\//.test(c?.mime || '') && c.mime !== 'image/svg+xml'
export const isVideo = (c) => /^video\//.test(c?.mime || '')

// 文本文件判定：mime 不可靠（.md 常是 octet-stream），扩展名做兜底
const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/toml',
  'application/x-sh',
])
const TEXT_EXT_RE =
  /\.(txt|md|log|json|js|mjs|ts|jsx|tsx|vue|css|scss|less|html?|xml|ya?ml|toml|ini|cfg|conf|env|sh|bat|py|java|c|h|cpp|hpp|cc|go|rs|rb|php|sql|csv|diff)$/i
export const isText = (c) =>
  /^text\//.test(c?.mime || '') || TEXT_MIMES.has(c?.mime) || TEXT_EXT_RE.test(c?.name || '')

/** 依据 MIME/扩展名粗分文件类型，返回 { icon, color, label }，用于文件卡片与列表。 */
export function fileKind(mime = '', name = '') {
  const ext = (name.match(/\.([a-z0-9]{1,6})$/i)?.[1] || '').toUpperCase()
  const k = (icon, color) => ({ icon, color, label: ext || 'FILE' })
  if (mime.startsWith('image/')) return k('🖼️', '#8a7cff')
  if (mime.startsWith('video/')) return k('🎬', '#e05a9b')
  if (mime.startsWith('audio/')) return k('🎵', '#26b8b0')
  if (/zip|compressed|tar|rar|7z|gzip/.test(mime) || /^(ZIP|RAR|7Z|TAR|GZ|TGZ|XZ|BZ2)$/.test(ext))
    return k('🗜️', '#e8a13c')
  if (mime.includes('pdf')) return k('📕', '#e64545')
  if (/sheet|excel|csv/.test(mime) || /^(XLSX?|CSV)$/.test(ext)) return k('📗', '#35b26f')
  if (/presentation|powerpoint/.test(mime) || /^PPTX?$/.test(ext)) return k('📙', '#ff7a59')
  if (/word|document/.test(mime) || /^DOCX?$/.test(ext)) return k('📘', '#4f8ff7')
  if (/^(ISO|IMG|DMG|VMDK|QCOW2|BIN)$/.test(ext)) return k('💿', '#5c6b7c')
  if (/^(EXE|MSI|DEB|RPM|APK|APPIMAGE)$/.test(ext)) return k('📦', '#5c6b7c')
  if (isText({ mime, name })) return k('📝', '#12b7f5')
  return k('📄', '#7a8a99')
}

// ---------- 搜索高亮 ----------

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => HTML_ESC[ch])

/** 转义 HTML 后再包 <mark>，供 v-html 安全使用。 */
export function highlight(text, q) {
  const safe = escapeHtml(text)
  q = String(q || '').trim()
  if (!q) return safe
  const esc = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safe.replace(new RegExp(esc, 'gi'), (m) => `<mark>${m}</mark>`)
}
