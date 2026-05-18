import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const allowedHosts = process.env.VITE_ALLOWED_HOSTS
  ? process.env.VITE_ALLOWED_HOSTS.split(',').map((host) => host.trim()).filter(Boolean)
  : true

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo-192.png', 'logo-512.png'],
      manifest: {
        name: 'AI Chat Group',
        short_name: 'AI Chat Group',
        description: 'AI Multi-Agent Group Chat Simulation Platform',
        theme_color: '#6750A4',
        background_color: '#FEF7FF',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'logo-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'logo-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/uploads\/avatars\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'avatar-images',
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/api\.openai\.com\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mui/x-charts')) return 'vendor-mui-charts'
            if (id.includes('@mui/icons-material')) return 'vendor-mui-icons'
            if (id.includes('@emotion/')) return 'vendor-emotion'
            if (id.includes('@mui/')) return 'vendor-mui-core'
            if (id.includes('react-router') || id.includes('@remix-run/')) return 'vendor-router'
            if (id.includes('react-i18next') || id.includes('i18next')) return 'vendor-i18n'
            if (id.includes('react/jsx-runtime') || id.includes('/react/') || id.includes('/react-dom/')) return 'vendor-react'
          }
        },
      },
    },
  },
})
