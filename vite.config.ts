import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const allowedHosts = process.env.VITE_ALLOWED_HOSTS
  ? process.env.VITE_ALLOWED_HOSTS.split(',').map((host) => host.trim()).filter(Boolean)
  : true

function manualDevUpdatePlugin(): Plugin {
  const clients = new Set<ServerResponse>()

  const notifyClients = () => {
    const payload = JSON.stringify({ updatedAt: Date.now() })
    for (const response of clients) {
      response.write(`event: update\n`)
      response.write(`data: ${payload}\n\n`)
    }
  }

  return {
    name: 'pneumata-manual-dev-update',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__pneumata_dev_updates', (request, response, next) => {
        if (request.method !== 'GET') {
          next()
          return
        }

        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
        response.write('\n')
        clients.add(response)

        request.on('close', () => {
          clients.delete(response)
        })
      })

      server.watcher.on('change', notifyClients)
      server.watcher.on('add', notifyClients)
      server.watcher.on('unlink', notifyClients)
    },
  }
}

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: false,
    allowedHosts,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/admin/(auth|users|ai|billing|audit|moderation|risk)(?:/.*)?$': {
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
    manualDevUpdatePlugin(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'logo-192.png', 'logo-512.png'],
      manifest: {
        name: 'Pneumata',
        short_name: 'Pneumata',
        description: 'AI Multi-Agent Social World Simulation Platform',
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
