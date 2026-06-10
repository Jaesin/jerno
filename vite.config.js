import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/jerno/',
  root: 'app',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
