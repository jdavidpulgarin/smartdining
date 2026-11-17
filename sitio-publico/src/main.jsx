import React from 'react';
import ReactDOM from 'react-dom/client';
import Carta from './Carta.jsx';
import './index.css';
import { obtenerConfiguracionPublica } from './services/configuracionService.js';
import { SITIO_URL } from './config.js';

// Enriquecer JSON-LD en runtime SOLO cuando la API responde con éxito
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
            description: 'Carta digital de SmartDining: pide y paga desde tu mesa con el QR.',
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
      // Si la configuración falló, el JSON-LD estático se deja tal cual
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
