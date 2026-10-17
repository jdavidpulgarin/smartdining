# Diseño del frontend cliente (J-01)

- **Figma (diseño y prototipo navegable):** https://www.figma.com/design/g20sFyIB3ZRFXu5DUZQDXo/SmartDining-%E2%80%93-Cliente?node-id=8-370
- **Cómo ver el prototipo:** abrir el enlace, ir a la página "Pantallas" y presionar ▶ (Presentar), arriba a la derecha. Se navega haciendo clic en los botones de cada pantalla.
- **Archivo:** "SmartDining – Cliente", marco de celular 390 x 844.

## Sistema de diseño oscuro (v2)

El frontend del comensal cuenta con un tema oscuro inmersivo diseñado específicamente para pantallas móviles tipo PWA (ancho máximo `max-w-md`, centrado).

### Paleta de colores (Tokens en `@theme`)

| Token | Valor | Uso |
| --- | --- | --- |
| `--color-fondo` | `#0B0B0B` | Fondo principal de la aplicación / pantalla |
| `--color-superficie` | `#161616` | Fondo de tarjetas, paneles y contenedores |
| `--color-superficie-2` | `#1F1F1F` | Controles secundarios, inputs y fondos interactivos |
| `--color-borde` | `#2A2A2A` | Bordes sutiles de separación y delimitación |
| `--color-primario` | `#E3242B` | Botones de acción principal, títulos destacados y bordes activos |
| `--color-primario-hover` | `#C81E24` | Estado hover / activo de botones primarios |
| `--color-primario-texto` | `#FF5A5F` | Textos rojos pequeños con alto contraste (enlaces, precios extra, estados) |
| `--color-texto` | `#FFFFFF` | Texto principal de alto contraste |
| `--color-texto-suave` | `#A3A3A3` | Texto secundario, descripciones y etiquetas complementarias |
| `--color-texto-tenue` | `#6B6B6B` | Textos auxiliares, placeholders y estados deshabilitados |
| `--color-acento` | `#F2B705` | Indicadores de advertencia y estado en preparación |
| `--color-exito` | `#2FA35A` | Confirmaciones, estado listo y operaciones exitosas |

> **Regla de contraste y accesibilidad:**
> El rojo primario (`#E3242B`) sobre fondo oscuro solo se utiliza para texto grande (≥ 24 px o ≥ 19 px en negrita) o como fondo de botones con texto blanco. Para cualquier texto rojo pequeño (como "← Volver al menú", "Editar plato", alérgenos o precios extra) se debe emplear `--color-primario-texto` (`#FF5A5F`) para garantizar legibilidad WCAG AA.

### Tipografía

Las fuentes se importan vía Google Fonts antes de `@import "tailwindcss"` en `src/index.css`:

- **Títulos de impacto (`--font-titulo`):** `'Bebas Neue'`, sans-serif. Utilizado en titulares grandes de portada, en mayúsculas, interlineado compacto (`leading-none`), tamaño entre 48px y 64px (ej. "MESA 5", "AREPA RELLENA", "CARRITO DE LA MESA", "ESTÁ EN LA COCINA").
- **Etiquetas y componentes (`--font-etiqueta`):** `'Barlow Condensed'`, sans-serif (pesos 600 y 700). Utilizado en mayúsculas con espaciado (`tracking-wider`) para encabezados de sección, nombres de platos e ingredientes, botones, chips, insignias y subtítulos.
- **Cuerpo de texto (`--font-cuerpo`):** `'Inter'`, sans-serif (pesos 400, 500, 600, 700). Utilizado en párrafos, descripciones y textos de ayuda.

### Componentes visuales

- **Contenedor:** Ancho `max-w-md` centrado con padding lateral de `16px`.
- **Tarjetas (`Card`):** `rounded-2xl`, fondo `--color-superficie` (`#161616`), borde `1px` en `--color-borde` (`#2A2A2A`). Seleccionada: borde de `2px` en `--color-primario`.
- **Botón primario (`Button`):** Fondo `--color-primario` (`#E3242B`), texto blanco, fuente `Barlow Condensed` en mayúsculas `18px`, `rounded-xl`, altura mínima de `48px`.
- **Botón secundario:** Fondo transparente o `--color-superficie-2`, borde `--color-borde`, texto blanco.
- **Selector de porción (`SelectorPorcion`):** Control segmentado `rounded-xl`, fondo `--color-superficie-2`, botón activo con fondo primario y texto blanco.
- **Barra inferior fija (`BottomBar`):** Con efecto backdrop-blur sobre fondo `--color-fondo`, calorías y precio grande en blanco.

## Pantallas

1. **Unión / Bienvenida:** Hero con foto de portada y degradado, detección automática del número de mesa desde el QR (payload base64url) o bienvenida general, input de nombre y botón "ENTRAR A LA MESA".
2. **Menú:** Portada con foto de comida de ancho completo ("NUESTRO MENÚ"), carrusel horizontal "ARMA TU PLATO", chips de categorías y listado de platos.
3. **Constructor:** Portada con foto del plato, enlace "← Volver al menú", selector paso a paso de ingredientes, control segmentado de porciones y barra inferior fija.
4. **Carrito de la mesa:** Portada hero "CARRITO DE LA MESA", tarjeta destacada con borde rojo "LO TUYO · {NOMBRE}" y total individual, notas para cocina y botón "ENVIAR PEDIDO A COCINA".
5. **Seguimiento:** Pantalla animada en tiempo real con halo dinámico, ilustraciones SVG interactivas en bucle por estado, línea de tiempo horizontal de 4 pasos, desglose de "TU ORDEN", lista compacta de "OTROS PEDIDOS DE LA MESA", selector multi-pedido y acción para llamar al mesero.
6. **Cuenta y pago:** Marcador de estado estilizado bajo el tema oscuro.
7. **Despedida:** Tarjeta de confirmación con mensaje de despedida y estilo visual coherente.

## Seguimiento animado (J-07)

El módulo de seguimiento (`/seguimiento`) ofrece una experiencia visual inmersiva y reactiva que mantiene al comensal informado sobre el ciclo de vida de sus pedidos y los de su mesa.

### Estados e Ilustraciones Vectoriales Animadas

Cada estado cuenta con su propia ilustración SVG inline, paleta cromática, halo radial suave y animación mediante `@keyframes` en CSS puro (definidos en `src/styles/seguimiento.css`):

1. **`recibido` (Pill gris / fondo `#2A2A2A`, texto blanco, título "YA LO TENEMOS"):**
   - Ilustración en bucle de 4 segundos: la comanda cae desde arriba al riel con rebote elástico (`drop`), se balancea suavemente (`sway`), imprime sus líneas una por una (`linea`) y recibe un sello de verificación verde (`sello`) antes de salir para reiniciar el ciclo.
2. **`en_preparacion` (Pill amarillo `#F2B705`, texto `#0B0B0B`, título "ESTAMOS COCINANDO"):**
   - Ilustración en bucle: sartén que se sacude (`sacude`), llamas dinámicas en la base (`llama`), ingredientes que saltan girando con trayectorias vectoriales independientes (`salta` con variable `--dx`) y columnas de vapor ascendente (`vapor`).
3. **`listo` (Pill rojo `#E3242B`, texto blanco, título "¡SALE CALIENTE!"):**
   - Ilustración en bucle: halo rojo pulsante difuminado (`brillo`), campana de servicio oscilando con ondas sonoras concéntricas (`campana`, `ondas`) y tapa de cloche metálica dando saltos (`tapa`).
4. **`entregado` / `pagado` (Pill verde `#2FA35A`, texto `#0B0B0B`, título "¡BUEN PROVECHO!"):**
   - Ilustración de celebración: plato servido que entra con un pop elástico de rebote (`plato-pop`), vapor sutil y cuatro chispas luminosas que titilan alrededor (`chispa`).
5. **`cancelado` (Pill `#2A2A2A`, texto `#A3A3A3`, título "PEDIDO CANCELADO"):**
   - Plato base con una insignia de cancelación roja (`#E3242B`) que entra con animación de pop una única vez (sin bucle continuo). Omite la línea de tiempo.

### Accesibilidad (A11y) y Rendimiento

- **Movimiento reducido (`prefers-reduced-motion: reduce`):** Regla global en CSS que desactiva todas las animaciones y transformaciones continuas (`animation: none !important`) para usuarios con sensibilidad al movimiento.
- **Lectores de pantalla:** Todas las ilustraciones SVG y elementos puramente decorativos portan `aria-hidden="true"`. La tarjeta principal de estado utiliza `aria-live="polite"` para anunciar cambios de estado sin interrumpir al usuario.
- **Dimensiones táctiles:** Todos los botones interactivos cumplen con el estándar mínimo de accesibilidad WCAG de 44 px de altura (botones de acción entre 52 px y 56 px).

### Multi-Pedido y Sincronización en Tiempo Real

- **Separación de pedidos de la mesa:** Divide automáticamente la lista proveniente de `GET /api/pedidos/mesa` en "TU ORDEN" (pedidos vinculados al alias del comensal en el JWT) y "OTROS PEDIDOS DE LA MESA" (filas compactas con el alias, resumen de ítems, código, tiempo transcurrido con `haceCuanto` y pill de estado).
- **Tira de chips multi-pedido:** Si el comensal ha enviado más de un pedido propio en la visita, aparece una barra superior de pestañas accesibles (`role="tablist"`) para alternar fácilmente entre ellos.
- **Eventos en vivo y reconexión:** Escucha los eventos `order:status` y `order:created` del `socket-server` mediante el hook `useSeguimientoMesa`. Implementa deduplicación estricta de eventos mediante un búfer circular de los últimos 200 `eventId`. Al reconectarse el socket, re-consulta la API completa para recuperar transiciones ocurridas durante la desconexión.
- **Aviso global "Sale caliente":** Notificación flotante de 5 segundos que se dispara en cualquier pantalla de la app (`Layout.jsx`) cuando un pedido perteneciente al usuario transiciona a estado `listo`.
- **Llamar al mesero:** Emisión de `mesa:llamar_mesero` con `eventId` único y cooldown de 60 segundos con cuenta regresiva en el botón y mensajes amigables ante `RATE_LIMIT` o problemas de red.

## Componentes

- **Button** (primario y secundario, altura mínima de `48 px`)
- **Badge**
- **Card**
- **IngredientCard**
- **ProgressBar**
- **BottomBar**
- **Header**
- **Modal**
- **Imagen**

Implementados en `frontend-cliente/src/components/ui/` y visibles en `/dev/ui` (solo en desarrollo).
