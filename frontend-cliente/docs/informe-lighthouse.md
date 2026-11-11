# Informe Lighthouse y Calidad PWA — `frontend-cliente`

- **Fecha:** 2026-11-11
- **Rama:** `feature/cliente-calidad-lighthouse`
- **Herramienta:** `lighthouse@12` (`12.8.2`), perfil móvil emulado (`--form-factor=mobile`)
- **Categorías medidas:** `performance`, `accessibility`, `best-practices`, `seo` *(nota: desde Lighthouse 12 la categoría `pwa` fue retirada del scoring numérico y los requisitos de manifest/instalabilidad se reflejan en Best Practices/metadatos).*

---

## 1. Método de medición

1. **Inicio (`/`) en build de producción:** `npm run build` + `npm run preview` (`http://localhost:4174/`).
2. **Rutas internas autenticadas en `DEV`:** `npm run dev` (`http://localhost:5174`) con sesión simulada de `Ana` (Mesa 5), carrito e historial de pedido inyectados antes de navegar mediante Chrome DevTools Protocol (`Target.setAutoAttach` + `Page.addScriptToEvaluateOnNewDocument`, `--disable-storage-reset`). En la fase posterior se ejecutaron las 5 rutas de `DEV` de forma individual con `--max-wait-for-load=90000` tras observar que la corrida conjunta en lote se bloqueaba al llegar a `/menu`.
3. **Nota sobre Performance en `DEV`:** En `VITE` dev server los módulos se sirven sin minificar y por separado; por ello el puntaje `Perf` de las rutas `DEV` no representa el rendimiento real de producción (para ese criterio se toma `/` en `preview`).

---

## 2. Tabla comparativa Antes vs Después

| Ruta | Entorno | Perf (Antes → Después) | A11y (Antes → Después) | Best Practices (Antes → Después) | SEO (Antes → Después) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `/` (Inicio) | `preview` (prod) | **78 → 88** (+10) | **100 → 100** | **96 → 100** (+4) | **91 → 100** (+9) |
| `/menu` | `dev` simulado | `N/A` (DEV) → `43` (DEV) | **100 → 100** | **96 → 96** | **92 → 66** *(esperado)* |
| `/armar/1001` | `dev` simulado | `N/A` (DEV) → `35` (DEV) | **100 → 100** | **96 → 96** | **92 → 66** *(esperado)* |
| `/carrito` | `dev` simulado | `N/A` (DEV) → `42` (DEV) | **100 → 100** | **96 → 96** | **91 → 63** *(esperado)* |
| `/seguimiento` | `dev` simulado | `N/A` (DEV) → `39` (DEV) | **95 → 100** (+5) | **96 → 96** | **91 → 63** *(esperado)* |
| `/pago` | `dev` simulado | `N/A` (DEV) → `39` (DEV) | **95 → 100** (+5) | **96 → 96** | **91 → 63** *(esperado)* |

### Métricas Web Vitals en Inicio (`/`, build de producción)

| Métrica | Antes | Después | Cambio |
| :--- | :---: | :---: | :---: |
| First Contentful Paint (FCP) | `3.0 s` | `3.0 s` | = |
| Largest Contentful Paint (LCP) | `4.6 s` (`4,550 ms`) | `3.2 s` (`3,180 ms`) | **-1.4 s** |
| Total Blocking Time (TBT) | `0 ms` | `0 ms` | = |
| Cumulative Layout Shift (CLS) | `0.035` | `0.035` | = |
| Speed Index (SI) | `3.0 s` | `3.0 s` | = |

> En `/menu`, `/armar/1001`, `/carrito`, `/seguimiento` y `/pago`, la caída en el índice numérico de `SEO` (`91–92 → 63–66`) es **intencional**: se añadió `robots.txt` (`Disallow`) y la etiqueta dinámica `<meta name="robots" content="noindex, nofollow">` para que los buscadores indexen la portada (`/`) pero no las URLs privadas de sesión de mesa.

---

## 3. Cambios implementados por categoría

### Accesibilidad (`fix(cliente): mejorar la accesibilidad de la pwa`)
- **Contraste WCAG AA (≥ 4.5:1):**
  - Se subió `--color-texto-tenue` de `#6B6B6B` a `#969696` y `--color-texto-suave` de `#A3A3A3` a `#B5B5B5` en `src/index.css`.
  - Se reemplazó `#6B6B6B` por `#969696` en `LineaTiempo.jsx`, `Seguimiento.jsx` y `Pago.jsx`.
  - En `Pago.jsx` se quitó `opacity-85` sobre el monto blanco dentro del botón rojo `#E3242B` (que bajaba a `3.64:1`) y se ajustó texto/borde en botones deshabilitados y `text-primario` pequeño a `text-primario-texto`.
- **Áreas táctiles mínimas (≥ 44×44 px):**
  - Enlace del logo `SD` en `Header.jsx` (`w-9 h-9` → `min-w-11 min-h-11`), botón cerrar toast en `Layout.jsx`, chips de `CategoriaFiltro.jsx`, botones de `SelectorPorcion.jsx`, volver al menú en `Constructor.jsx`, `Reintentar` en `Inicio.jsx`, enlace agregar en `Carrito.jsx` y `Reintentar aviso al mesero` en `Pago.jsx`.
- **Foco visible, teclado y modales:**
  - Focus trap (`Tab` / `Shift+Tab`) agregado en `Modal.jsx`, conservando cierre con `Escape` y restauración del foco al elemento disparador.
  - Enlace *Saltar al contenido* (`sr-only focus:not-sr-only`) y landmark `<main>` garantizado en `Layout.jsx`, `Inicio.jsx` y `Despedida.jsx`.
  - Soporte global `@media (prefers-reduced-motion: reduce)` en `src/index.css` (complementando los existentes en `seguimiento.css` y `cuenta.css`).
- **Semántica, encabezados y alertas:**
  - Garantizado un `<h1>` por vista incluso en estados vacíos o de error (`Carrito.jsx`, `Seguimiento.jsx`, `Menu.jsx`, `Constructor.jsx`, `Pago.jsx`).
  - Atributos `role="alert"` en bloques de error de `Menu.jsx`, `Constructor.jsx` y `Pago.jsx`, y `aria-pressed` en `CategoriaFiltro.jsx`.

### Rendimiento (`perf(cliente): mejorar la carga de la pwa`)
- **Code splitting por ruta (`src/App.jsx`):** `Menu`, `Constructor`, `Carrito`, `Seguimiento`, `Pago`, `Despedida` y `UiShowcase` pasan a `React.lazy` + `<Suspense>`, dejando solo `Inicio` en el chunk inicial.
  - El JS principal (`dist/assets/index-*.js`) bajó de **`476.70 kB`** (`139.60 kB` gzip) a **`268.37 kB`** (`83.20 kB` gzip) en el build final (**-43.7 %**).
- **Fuentes y preconnect (`index.html` y `src/index.css`):** Se eliminó el `@import url(...)` bloqueante dentro de `src/index.css` y se movió a `<link rel="stylesheet">` en `index.html` acompañado de `preconnect` a `fonts.googleapis.com`, `fonts.gstatic.com` e `images.unsplash.com`.
- **Imágenes (`Inicio.jsx`, `Menu.jsx`, `Carrito.jsx`, `Constructor.jsx`, `Imagen.jsx`, `PlatoCard.jsx`, `PlatoDetalleModal.jsx`, `LineaCarrito.jsx`):**
  - Hero/LCP: ajuste de `w=1200` → `w=800&q=75`, `fetchPriority="high"`, `decoding="async"`, `width`/`height` explícitos y `<link rel="preload" as="image">` en `index.html` para la imagen de portada.
  - Cards y listas: `loading="lazy"`, `decoding="async"` y dimensiones `width`/`height` para evitar CLS.
  - En Inicio se eliminaron los avisos de `uses-responsive-images` (`51 KiB`), `image-delivery-insight` (`72 KiB`), `uses-rel-preconnect` (`350 ms`), `unused-javascript` (`96 KiB`) y `forced-reflow-insight`.

### Buenas prácticas, SEO y PWA (`chore(cliente): completar manifest y metadatos de la pwa`)
- **Consola limpia en `/`:** En `CarritoContext.jsx`, la carga automática de `obtenerMenuRaw()` ahora se ejecuta solo cuando existe `mesa` activa (`if (!mesa) return undefined` con dependencia `[mesa]`), evitando la petición fallida a `/api/menu` antes de escanear mesa. Con esto `Best Practices` en `/` subió de `96` a **`100`**.
- **Metadatos y manifest (`index.html`, `vite.config.js`):** Se completaron `robots`, `mobile-web-app-capable`, `apple-mobile-web-app-*`, `og:*`, y en el manifest PWA `id`, `lang: 'es'`, `categories` e inclusión de `robots.txt` en `includeAssets` (manteniendo íconos `192`, `512` y `maskable 512`).
- **`robots.txt` y títulos por ruta (`public/robots.txt`, `src/utils/metadatosRuta.js`):** Permite `/` (`SEO: 100` en Inicio) y excluye `/menu`, `/armar`, `/carrito`, `/seguimiento`, `/pago` y `/despedida` tanto en `robots.txt` como vía `<meta name="robots">` dinámico.

---

## 4. Top 3 módulos más pesados en el bundle de producción

Medición tomada sobre el output de `vite build` (`renderedLength` pre-minificado por módulo y peso del chunk resultante):

1. **`node_modules/react-dom/cjs/react-dom-client.production.js`** — `529.56 kB` sin minificar (empaquetado en `dist/assets/index-*.js`, total chunk `268.37 kB` / `83.20 kB` gzip).
2. **`node_modules/react-router/dist/development/chunk-OB3PAWPO.mjs`** — `92.78 kB` sin minificar (en `dist/assets/SesionContext-*.js`, total chunk `90.79 kB` / `30.36 kB` gzip).
3. **`src/pages/Pago.jsx`** — `45.09 kB` sin minificar (separado ahora en chunk lazy `dist/assets/Pago-*.js`, `28.72 kB` / `8.00 kB` gzip, por lo que no penaliza la carga inicial de `/`).

---

## 5. Pendientes recomendados para infraestructura / backend (Roberto)

Los siguientes puntos detectados por Lighthouse no pertenecen al código estático de `frontend-cliente/` y corresponden al servidor web / backend en despliegue:

1. **Compresión HTTP (`gzip` / `brotli`):** En `vite preview` sigue apareciendo `uses-text-compression` (~`14 KiB`); en Nginx / CDN / hosting de producción habilitar compresión `br` y `gzip` para HTML, CSS, JS, JSON y SVG.
2. **Cache HTTP inmutable para assets con hash:** Servir `/assets/*` con `Cache-Control: public, max-age=31536000, immutable` y `/index.html`, `/sw.js` y `/manifest.webmanifest` con `no-cache` / revalidación inmediata.
3. **Imágenes de platos optimizadas desde backend/CDN:** Servir imágenes del menú en formato WebP/AVIF y tamaños acotados (ej. miniaturas ~`200–400 px` y portada ~`800 px`) en lugar de URLs de alta resolución sin recorte.
4. **Cabeceras de seguridad HTTP:** Configurar HTTPS + HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy` y `Content-Security-Policy` (incluyendo orígenes permitidos de Wompi, fuentes y Socket.IO).

---

## 6. Limitaciones de esta medición local

- `Performance` en `/menu`, `/armar/1001`, `/carrito`, `/seguimiento` y `/pago` se midió sobre el servidor de desarrollo (`vite dev`), por lo que refleja tiempos de compilación/entrega sin minificar y no es representativo de producción (`35–43`).
- En las 5 rutas `DEV`, `Best Practices` quedó en `96` (`errors-in-console`) debido exclusivamente a que `socket-server` (`ws://localhost:4001`) no estaba encendido durante las mediciones aisladas de frontend.
- En todas las rutas con `<Header />`, Lighthouse registra `label-content-name-mismatch` con peso `0` (no afecta el puntaje `100` de Accesibilidad) en los enlaces `SD` (`aria-label="Inicio SmartDining"`) y `Mis pedidos` (badge numérico visual).
- Todas las 6 rutas fueron medidas sin omitir ninguna (`inicio-preview`, `menu-dev`, `constructor-dev`, `carrito-dev`, `seguimiento-dev`, `pago-dev`).
