# Videos del sitio público (`/carta`)

Coloca en esta carpeta (`frontend-cliente/public/videos/`) los archivos de video para el sitio público de solo lectura:

1. **`portada.mp4`**: Video de fondo para la portada principal (hero) de `/carta`.
2. **`arma-tu-plato.mp4`**: Video de fondo para la sección destacada **"Arma tu plato"** en `/carta`.

## Especificaciones recomendadas

- **Formato**: MP4 (codec H.264) para máxima compatibilidad en navegadores de computador y celular.
- **Orientación**: Horizontal (por ejemplo, `1920x1080` o `1280x720`, proporción `16:9`).
- **Duración**: Entre **8 y 15 segundos** (se reproducen en bucle continuo).
- **Peso máximo**: **Menos de 3 MB** por archivo (comprimidos para carga rápida en redes móviles).
- **Audio**: **Sin pista de audio** (se reproducen silenciados con `muted`).
- **Licencia**: Material propio del restaurante o con **licencia libre de derechos** para uso comercial.

## Comportamiento de respaldo y ahorro de datos

- Si los archivos `.mp4` aún no están en esta carpeta o fallan al cargar, la página muestra automáticamente la imagen de respaldo (`poster`) tomada del menú o de `public/`.
- Si el visitante tiene activado `prefers-reduced-motion` o el ahorro de datos del navegador (`navigator.connection.saveData`), el video no se descarga y se muestra únicamente la imagen estática.

## Dónde cambiar las rutas

Las rutas de ambos videos están definidas en la constante `VIDEOS_SITIO` dentro de:

- `frontend-cliente/src/utils/sitioPublico.js`
