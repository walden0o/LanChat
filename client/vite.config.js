import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发模式下将 API 与 WebSocket 代理到本机 3000 端口的后端
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://localhost:1111',
      '/socket.io': { target: 'http://localhost:1111', ws: true },
    },
  },
})
