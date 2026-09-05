import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // alert-bundle.json is fetched at runtime (see src/lib/useSimulation.ts),
      // not imported by any module, so it needs an explicit glob -- Workbox's
      // default precache patterns only pick up JS/CSS/HTML/ico/png/svg.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
      },
      manifest: {
        name: 'LIGTAS',
        short_name: 'LIGTAS',
        description: 'Barangay flood alert display -- offline-first resident view',
        start_url: '/',
        display: 'standalone',
        background_color: '#020617',
        theme_color: '#020617',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
})
