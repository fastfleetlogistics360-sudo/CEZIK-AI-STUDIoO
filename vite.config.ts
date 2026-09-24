import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    // Transformers.js currently asks for this ONNX subpath during bundling.
    // The browser build is included here so visitors can use the local model.
    alias: { 'onnxruntime-web/webgpu': fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.webgpu.min.js', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The background-removal runtime is fetched only after its tool is opened.
        globIgnores: ['**/transformers.web-*.js'],
      },
      manifest: {
        name: 'CEZIK AI Studio',
        short_name: 'CEZIK',
        description: 'The creative operating system for AI video.',
        theme_color: '#090613',
        background_color: '#090613',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/cezik-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
})
