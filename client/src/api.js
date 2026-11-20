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
  uploadLimit: () => request('/files/limit'),
  saveStorageSettings: (body) => request('/storage-settings', { method: 'POST', body }),
  runCleanup: () => request('/cleanup', { method: 'POST', body: {} }),
  toggleDisabled: (id) => request(`/users/${id}/disable`, { method: 'POST' }),
  toggleAdmin: (id) => request(`/users/${id}/admin`, { method: 'POST' }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
}

/**
 * 上传文件（XHR 实现：fetch 无法获取上传进度）。
 * @param {File} file
 * @param {{ onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<{fileId:number,name:string,size:number,mime:string}>}
 */
export function uploadFile(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files')
    if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total)
    }
    xhr.onload = () => {
      let data = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch { /* 非 JSON 响应 */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data.error || `上传失败（${xhr.status}）`))
    }
    xhr.onerror = () => reject(new Error('网络错误，上传中断'))
    xhr.onabort = () => {
      const err = new Error('已取消')
      err.name = 'AbortError'
      reject(err)
    }
    signal?.addEventListener('abort', () => xhr.abort())
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

/** 文件直链（<img>/<video> 无法带 Authorization 头，通过 ?token= 传递凭证）。 */
export const fileUrl = (fileId, { download = false } = {}) =>
  `/api/files/${fileId}?token=${encodeURIComponent(state.token)}${download ? '&dl=1' : ''}`

/**
 * 下载文件：直接让浏览器走原生下载（服务端返回 attachment）。
 * 不再 fetch → blob：那样会把整个文件读进内存，GB 级大文件会撑爆浏览器，
 * 原生下载还自带进度条、断点与暂停。
 * @param {number} fileId
 * @param {string} filename 保存文件名
 */
export function downloadFile(fileId, filename) {
  const a = document.createElement('a')
  a.href = fileUrl(fileId, { download: true })
  a.download = filename || ''
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
