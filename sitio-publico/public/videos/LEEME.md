# Videos del sitio público (`/`)

Coloca en esta carpeta (`sitio-publico/public/videos/`) los archivos de video para el sitio público:

## 1. Portada (Hero)
- **`portada.mp4`**: Video de fondo en resolución 720p para pantallas de computador y dispositivos de escritorio.
- **`portada-480.mp4`**: Versión ligera optimizada para celulares y pantallas pequeñas.
- **`portada-poster.webp`**: Póster estático en formato WebP que se carga de inmediato en el HTML inicial para garantizar un LCP óptimo.

## 2. Platos armables ("Arma tu plato")
Los videos de los platos armables se configuran en el objeto `videosPlatos` dentro de `src/datos/restaurante.js` asociados por el nombre exacto del plato:
- **`arepa.mp4`** con **`arepa-poster.webp`**: Para el plato "Arepa Rellena".
- **`bowl.mp4`** con **`bowl-poster.webp`**: Para el plato "Bowl Personalizado".
- **`wrap.mp4`** con **`wrap-poster.webp`**: Para el plato "Wrap Personalizado".

## Límites y especificaciones técnicas
- **Formato**: MP4 (códec H.264) para máxima compatibilidad web y móvil.
- **Audio**: Sin pista de audio (se reproducen silenciados con `muted`).
- **Resolución**: 720p máximo.
- **Peso máximo**: Máximo 5 MB por archivo.
- **Póster de respaldo**: Formato WebP.

## Créditos y generación con Inteligencia Artificial
- Los cuatro videos (`portada.mp4`, `arepa.mp4`, `bowl.mp4` y `wrap.mp4`) son generados con IA (Gemini).
- Ya no hay etiquetas "Video generado con IA" en la interfaz; el crédito va en una línea del pie: "Imágenes y videos ilustrativos generados con IA · Imagen base del bowl: Freepik" (la licencia de Freepik exige el crédito).

## Comportamiento de respaldo, rendimiento y accesibilidad
- Si un video aún no se encuentra disponible o falla al cargar, la página muestra de forma automática la imagen de respaldo (`poster`) en formato WebP.
- Si el visitante tiene activada la preferencia de reducción de movimiento (`prefers-reduced-motion`) o el ahorro de datos en su navegador (`saveData`), no se descarga ningún video y se mantiene la imagen estática.
