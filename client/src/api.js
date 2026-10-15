/**
 * REST 请求封装：自动附带 JWT，统一抛出后端返回的 error 文案。
 */
import { state } from './store.js'

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {}
  if (state.token) headers.Authorization = `Bearer ${state.token}`
  let payload
  if (form) {
    payload = form // FormData：让浏览器自动生成 multipart 边界
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`)
  return data
}

export const api = {
  register: (username, password, nickname) =>
    request('/register', { method: 'POST', body: { username, password, nickname } }),
  login: (username, password) =>
    request('/login', { method: 'POST', body: { username, password } }),
  contacts: () => request('/contacts'),
  users: () => request('/users'),
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  stats: () => request('/stats'),
  files: (limit) => request(limit ? `/files?limit=${limit}` : '/files'),
  deleteFile: (id) => request(`/files/${id}`, { method: 'DELETE' }),
  storageSettings: () => request('/storage-settings'),
  saveStorageSettings: (body) => request('/storage-settings', { method: 'POST', body }),
  runCleanup: () => request('/cleanup', { method: 'POST', body: {} }),
  toggleDisabled: (id) => request(`/users/${id}/disable`, { method: 'POST' }),
  toggleAdmin: (id) => request(`/users/${id}/admin`, { method: 'POST' }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  uploadFile: (file) => {
    const form = new FormData()
    form.append('file', file)
    return request('/files', { method: 'POST', form })
  },
}

/**
 * 带鉴权下载文件并触发浏览器保存。
 * @param {number} fileId
 * @param {string} filename 保存文件名
 */
export async function downloadFile(fileId, filename) {
  const res = await fetch(`/api/files/${fileId}`, {
    headers: { Authorization: `Bearer ${state.token}` },
  })
  if (!res.ok) throw new Error('文件下载失败')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
