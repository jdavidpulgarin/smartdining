import React from 'react';
import ReactDOM from 'react-dom/client';
import Carta from './Carta.jsx';
import './index.css';
import { obtenerConfiguracionPublica } from './services/configuracionService.js';
import { SITIO_URL } from './config.js';

// Enriquecer JSON-LD en runtime cuando llega la configuración
if (typeof document !== 'undefined') {
  obtenerConfiguracionPublica()
    .then((config) => {
      try {
        const script = document.getElementById('restaurant-jsonld');
        if (script && config) {
          const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'Restaurant',
            name: config.nombre || 'SmartDining',
            description: 'Menú digital interactivo y platos a la carta',
            servesCuisine: 'Parrilla, Fusión, Internacional',
            url: SITIO_URL,
          };
          if (config.telefono) jsonLd.telephone = config.telefono;
          if (config.direccion) {
            jsonLd.address = {
              '@type': 'PostalAddress',
              streetAddress: config.direccion,
            };
          }
          if (config.url_logo) jsonLd.image = config.url_logo;
          script.textContent = JSON.stringify(jsonLd, null, 2);
        }
      } catch {
        // Fallback: se conserva el JSON-LD estático de index.html
      }
    })
    .catch(() => {
      // Fallback: si falla la carga, el JSON-LD estático permanece intacto
    });
}

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Carta />
    </React.StrictMode>
  );
}
