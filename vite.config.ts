import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@xenova/transformers']
  },
  worker: {
    format: 'es'
  },
  server: {
    port: 5173
  }
})
