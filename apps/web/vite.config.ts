import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the preview under /<repo>/; everywhere else the app lives at the root.
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // There is no update prompt in the UI: take over as soon as a deploy is found, or an open
      // tab keeps running the old version until every tab of the site is closed.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Smart LTC Care',
        short_name: 'Smart LTC',
        description: 'ระบบสนับสนุนการจัดการดูแลระยะยาวของหน่วยบริการ',
        theme_color: '#0284C7',
        background_color: '#F8FAFC',
        display: 'standalone',
        lang: 'th',
        icons: []
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        runtimeCaching: [],
        globPatterns: ['**/*.{js,css,html,svg,woff2}']
      }
    })
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } }
  }
});

