import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
