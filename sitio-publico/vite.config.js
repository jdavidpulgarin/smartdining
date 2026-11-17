import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { generarRobots, generarSitemap } from './src/seo/generar.js';

function pluginSeo() {
  return {
    name: 'plugin-seo',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const sitioUrl = (process.env.VITE_SITIO_URL || 'http://localhost:5176').replace(/\/+$/, '');
        return html.replaceAll('%VITE_SITIO_URL%', sitioUrl);
      }
    },
    generateBundle() {
      const sitioUrl = process.env.VITE_SITIO_URL || 'http://localhost:5176';
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: generarRobots(sitioUrl)
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: generarSitemap(sitioUrl)
      });
    }
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    pluginSeo()
  ],
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
});
