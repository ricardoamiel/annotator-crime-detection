import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In local dev: forward /imgs/* and /api/* to Flask on port 5000
      '/imgs': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: false,
      },
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: false,
      },
    },
  },
})