import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Relative assets allow subdirectory hosting and a future desktop container.
  base: './',
  server: { port: 5173, strictPort: true },
})
