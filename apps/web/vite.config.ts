import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
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
        navigateFallback: '/index.html',
        runtimeCaching: [],
        globPatterns: ['**/*.{js,css,html,svg}']
      }
    })
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } }
  }
});

