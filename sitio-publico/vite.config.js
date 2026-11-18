import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { generarRobots, generarSitemap } from './src/seo/generar.js';
import restaurante from './src/datos/restaurante.js';
import {
  construirJsonLd,
  construirMetaDescription,
  serializarJsonLdSeguro,
} from './src/seo/jsonLd.js';

function pluginSeo() {
  return {
    name: 'plugin-seo',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const sitioUrl = (process.env.VITE_SITIO_URL || 'http://localhost:5176').replace(/\/+$/, '');
        const title = `${restaurante.nombre} · Carta, historia y contacto`;
        const description = construirMetaDescription(restaurante);
        const jsonLd = construirJsonLd(restaurante, sitioUrl);
        const scriptJsonLd = `<script type="application/ld+json" id="restaurant-jsonld">\n${serializarJsonLdSeguro(jsonLd)}\n    </script>`;

        let resultado = html.replaceAll('%VITE_SITIO_URL%', sitioUrl);
        resultado = resultado.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
        resultado = resultado.replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${description}" />`);
        resultado = resultado.replace(/<meta property="og:title" content=".*?" \/>/, `<meta property="og:title" content="${title}" />`);
        resultado = resultado.replace(/<meta property="og:description" content=".*?" \/>/, `<meta property="og:description" content="${description}" />`);
        resultado = resultado.replace(/<meta name="twitter:title" content=".*?" \/>/, `<meta name="twitter:title" content="${title}" />`);
        resultado = resultado.replace(/<meta name="twitter:description" content=".*?" \/>/, `<meta name="twitter:description" content="${description}" />`);
        resultado = resultado.replace(/<script type="application\/ld\+json" id="restaurant-jsonld">[\s\S]*?<\/script>/, scriptJsonLd);
        return resultado;
      },
    },
    generateBundle() {
      const sitioUrl = process.env.VITE_SITIO_URL || 'http://localhost:5176';
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: generarRobots(sitioUrl),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: generarSitemap(sitioUrl),
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    pluginSeo(),
  ],
  test: {
    fileParallelism: false,
  },
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
