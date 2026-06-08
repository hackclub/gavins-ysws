import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, forward /api/* to the Express backend (server.js on :3001)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
