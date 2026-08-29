import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 反向代理域名需显式放行，否则 Vite 的 DNS rebinding 防护会拦截请求
    allowedHosts: ['hub.starfall.cc.cd'],
  },
  preview: {
    allowedHosts: ['hub.starfall.cc.cd'],
  },
})
