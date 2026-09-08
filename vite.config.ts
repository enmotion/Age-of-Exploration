import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { templateCompilerOptions } from '@tresjs/core'

export default defineConfig({
  plugins: [vue(templateCompilerOptions)],
  server: { port: 5173, strictPort: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/mapbox-gl/')) return 'mapbox'
          if (id.includes('/node_modules/three/')) return 'three'
        },
      },
    },
  },
})
