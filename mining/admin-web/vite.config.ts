import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    proxy: {
      '/api': {
        // 本地管理员 API：去掉 /api 前缀后转发到 ADMIN_API_PORT。
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/market-api': {
        // 本地市场索引器，默认端口 42069。
        target: 'http://127.0.0.1:42069',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/market-api/, ''),
      },
    },
  },
})
