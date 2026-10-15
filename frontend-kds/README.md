# 🍳 Frontend KDS (Kitchen Display System)

**Responsable:** Carlos Ospino (Integrante 3)

Pantalla de cocina: muestra las comandas activas en tres columnas y se actualiza en
tiempo real. Pensada para un monitor o una pantalla táctil en el área de preparación,
con tema oscuro de alto contraste y texto grande para leerse a distancia.

## Cómo correrlo

```bash
cd frontend-kds
npm install
npm run dev          # http://localhost:5175
```

Necesita el **backend** (`:4000`) y el **socket-server** (`:4001`) levantados.

| Script | Qué hace |
|---|---|
| `npm run dev` | Vite en el puerto 5175 (`strictPort`: si está ocupado, falla en vez de moverse) |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve el build |
| `npm run lint` | oxlint |
| `npm test` | `node --test` sobre la lógica pura: tablero, umbrales, pase, resumen y conexión |

El puerto es 5175 a propósito: es el origen que el socket-server tiene en su
`CORS_ORIGINS`. Si Vite arrancara en otro puerto, el tiempo real quedaría bloqueado por
CORS sin un mensaje claro, y `strictPort` evita justamente eso.

## Variables de entorno

Copia `.env.example` a `.env` (ese archivo **no se commitea**):

| Variable | Por defecto | Para qué |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000/api` | Login y carga inicial de comandas |
| `VITE_SOCKET_URL` | `http://localhost:4001` | Eventos `order:created` y `order:status` |

> **Seguridad:** el KDS **no lleva secretos**. Se autentica con el JWT que devuelve
> `POST /api/auth/login` y nada más. La `INTERNAL_API_KEY` es del canal
> servidor-a-servidor (backend ↔ socket-server) y **nunca** debe ponerse en una variable
> `VITE_`: todo lo que empieza por `VITE_` se empaqueta en el bundle y queda a la vista
> de cualquiera que abra el navegador.

## Acceso

Entran solo los roles **`cocina`** y **`admin`** (los mismos que acepta
`GET /api/kds/comandas`). Con cualquier otro rol el login responde *"Este usuario no
tiene acceso a la cocina"*, aunque las credenciales sean correctas.

El JWT se guarda en **`sessionStorage`**, no en `localStorage`: la pantalla de cocina es
un equipo compartido y la sesión no debería seguir abierta para el siguiente turno. Si el
almacenamiento no está disponible (modo privado, storage bloqueado) la app funciona
igual: la sesión vive en memoria y se pierde al recargar.

La sesión se cierra sola, con aviso, ante cualquier **401** de la API o un
`connect_error` del socket con `TOKEN_INVALIDO` / `AUTH_REQUERIDA`. El botón **Salir**
limpia el storage y desconecta el socket.

## Cómo se arma el tablero

1. Al entrar (y en **cada reconexión** del socket) se pide `GET /api/kds/comandas` y se
   **reemplaza** el estado completo. No se mezcla: mientras el socket estuvo caído pudieron
   pasar cosas que no llegaron, y mezclar dejaría comandas fantasma. Desde D-09 ese
   endpoint **también devuelve las comandas en `listo`**, así que la columna "Listas"
   sobrevive a recargar y a reconectar.
2. `order:created` agrega la comanda en **Nuevas**; `order:status` la mueve de columna, o
   la quita del tablero si pasa a `entregado`, `pagado` o `cancelado`.
3. Los eventos se deduplican por `eventId` (el socket-server reintenta, EVENTS.md §3.1) y
   por `id_pedido` (para no duplicar una comanda que ya estaba en pantalla).
4. Los minutos de cada tarjeta parten de `minutos_transcurridos` de la API y avanzan con
   el reloj local, refrescándose cada 30 s **sin pedir nada al servidor**.

Toda esa lógica está en funciones puras y se prueba con `npm test` sin montar React:
[`src/lib/comandas.js`](src/lib/comandas.js) (columnas, eventos, deduplicación),
[`src/lib/espera.js`](src/lib/espera.js) (umbrales y formato del cronómetro) y
[`src/lib/preferencias.js`](src/lib/preferencias.js) (tema y sonido). Los efectos (pedir,
conectar, reconectar, PATCH) están aparte en
[`src/lib/useTablero.js`](src/lib/useTablero.js), y el reloj compartido en
[`src/hooks/useCronometro.js`](src/hooks/useCronometro.js).

## Operación (D-09)

**Botones por comanda.** El avance es de la **comanda completa**, no plato a plato, que es
lo que acepta `PATCH /api/kds/comandas/:id/estado`:

| Columna | Botón | Pasa a |
|---|---|---|
| Nuevas | **Empezar** | `en_preparacion` |
| En preparación | **Marcar listo** | `listo` |
| Listas | *(sin botón)* | La saca el mesero marcando `entregado` |

El botón mide 64 px de alto (más que el mínimo táctil de 48) y **se deshabilita mientras la
petición está en vuelo**, para que un segundo toque impaciente no mande dos PATCH. La
tarjeta se mueve con la respuesta, sin esperar el evento del socket; si el aviso llega
después con el mismo estado, el resultado es idéntico. Si la base rechaza la transición
(lo decide un trigger), el mensaje sale **en la propia tarjeta** y el tablero se recarga,
porque significa que lo que se ve ya no es lo que hay guardado.

**Cronómetro y semáforo.** Un solo intervalo de 1 s para todo el tablero (no uno por
tarjeta) alimenta los minutos desde `creado_en`:

| Espera | Nivel |
|---|---|
| < 10 min | normal |
| 10 a 15 min | ámbar |
| > 15 min | rojo |

A partir de 100 minutos se muestra **"+99 min"**: los datos sembrados traen comandas de
hace semanas (19.000 min) y un número de cinco dígitos no informa de nada.

El tiempo va en un **chip** que se pinta con el nivel, y el rojo además levanta un aviso
de ancho completo **"ATRASADA · PRIORIDAD"** bajo la cabecera de la tarjeta. El nivel **no
se señala solo con color**: el texto ("En tiempo", "Apurar", "Atrasada") sigue en el
`title` del chip y en un `sr-only`, por si el monitor está mal calibrado, quien mira no
distingue rojo de ámbar o se usa un lector de pantalla.

Qué significa cada color no se aprende adivinando: la **barra roja** bajo la cabecera lleva
la leyenda de los tres niveles con sus minutos, y las cifras salen de `UMBRAL_AMBAR` y
`UMBRAL_ROJO` en vez de escribirse a mano, para que no se queden mintiendo si la cocina
cambia los umbrales. Esa misma barra dice cuántas **comandas activas** hay, que es la suma
de los tres contadores de las columnas (el pase incluido: una comanda sin recoger sigue
siendo una mesa esperando).

**La columna LISTAS (el pase).** Ahí el reloj que importa no es el total desde que se
pidió, sino cuánto lleva **hecha y sin recoger**, que es lo que el mesero puede arreglar.
Se cuenta desde que pasó a `listo`: `listo_en` de la API (sale de `historial_estados`) o,
si la transición llegó en vivo, el `emitidoEn` del `order:status`.

En esa columna **el reloj grande muestra ese tiempo**, no el total: es el único que el
mesero puede cambiar, y es el que explica el aviso de debajo. El total sigue a mano en el
tooltip (*"En el pase desde hace 35 min · pedida hace 40 min"*). Si no se sabe cuándo
quedó lista, el reloj cae al total en vez de inventar un 0. En Nuevas y En preparación no
cambia nada: ahí el reloj es el total, que es lo que mide la espera del comensal.

- El pase va ordenado **al revés** que las otras columnas: arriba lo que acaba de salir.
  Las comandas sin hora de `listo` (de antes de que existiera el dato) caen al final.
- Pasados **30 minutos** en el pase (`UMBRAL_SIN_RECOGER_MIN`, en
  [`src/lib/pase.js`](src/lib/pase.js)), la tarjeta se **atenúa** y aparece *"Sin recoger
  hace N min"*, con el mismo tope `+99 min`. Cuando esa cifra es la misma que la del reloj
  grande (el caso normal) el aviso se queda en *"Sin recoger · avisar al mesero"*, sin
  repetir el número:
  verlo dos veces en la misma tarjeta hace dudar de si son cosas distintas. Atenuada,
  **no escondida**: una comanda
  olvidada tiene que seguir viéndose, solo deja de competir por la atención con las
  recién salidas. Sin rojo y sin "ATRASADA": la cocina ya hizo su parte.

En esa columna el reloj dice **"N min en pase"**, no "N min" a secas: la cifra es otra que
la de las demás columnas y conviene que se note.

**Detalle del plato.** El alias del comensal aparece junto al plato y, agrupados y sin
repetir, también en la cabecera de la tarjeta al lado del número de pedido: de un vistazo
se ve para cuánta gente es la mesa. Los
ingredientes van agrupados por paso del constructor, en ese orden, marcando **EXTRA** y
**LIGERA**; `normal` no se adorna, que es la que no sorprende. Un plato sin ingredientes se
ve como siempre.

**Sonido, pantalla y tema.**

- Aviso sonoro con Web Audio (dos tonos cortos, sin archivos) **solo cuando entra una
  comanda nueva por `order:created`** — nunca al recargar ni al reconectar. Los navegadores
  bloquean el audio sin un gesto previo, así que la elección se hace donde hay un gesto
  seguro: la casilla **"Activar aviso sonoro al entrar"** del login, que prepara el
  `AudioContext` en el envío del formulario. En el tablero hay además un botón para
  silenciarlo o activarlo, y la elección se recuerda en `localStorage`.
- Botón de **pantalla completa** (Fullscreen API), con su salida.
- **Oscuro por defecto**, con interruptor claro/oscuro recordado. `prefers-color-scheme`
  solo decide la primera vez, si nadie eligió todavía.

Todas las preferencias leen y escriben `localStorage` dentro de `try/catch`: si está
bloqueado, el KDS funciona igual y solo se pierde recordar la elección.

## Cuando se cae la conexión

Son **dos caídas distintas** y el KDS no las trata igual, porque el avance de comandas va
por **HTTP** y el tiempo real por el **socket**: son canales separados.

- **Socket caído.** El indicador pasa a **DESCONECTADO** en rojo y sale un aviso de ancho
  completo (*"Sin conexión con el servidor"*) con el botón **Recargar ahora**. Es el peor
  de los dos fallos y el que menos se nota solo: la pantalla se queda congelada, las
  comandas nuevas no entran y no hay ningún error de API detrás que lo delate. Por eso el
  aviso **no** cuelga de `estado.error`. Mientras dura, la cabecera se queda con el reloj
  y **Salir**: lo único que se puede hacer está en el aviso.
- **El botón de la tarjeta sigue activo.** Que el socket esté caído no impide cambiar el
  estado, y el movimiento optimista existe justo para no depender de él.
- **"Esperando conexión…"** aparece solo cuando el PATCH falló **sin respuesta del
  servidor** (fallo de red, no un 409 del trigger) **y además** el socket está caído: es
  decir, cuando volver a tocar repetiría el mismo fallo y hay algo —la reconexión— que
  pueda desbloquearlo. Si el socket está vivo y aun así el PATCH no llegó, el botón sigue
  activo con su mensaje, porque reintentar es lo único sensato.

La decisión está en `avisoDelTablero()` y `debeEsperarConexion()`
([`src/lib/comandas.js`](src/lib/comandas.js)), fuera de los componentes y probadas en
[`tests/conexion.test.js`](tests/conexion.test.js).

## Panel de agotados (D-10)

El botón con el icono de caja tachada, en la cabecera, abre un cajón lateral con **todos
los ingredientes de la carta agrupados por plato y por paso**. Cada fila es un interruptor:
un toque lo marca **Agotado**, otro lo **repone**.

- **Insignia con el número de agotados** en el botón, para saber si hay algo apagado sin
  abrir el panel. Si no hay ninguno, no se pinta nada.
- **Sin confirmación**: la acción es reversible con el mismo toque, y un diálogo a mitad de
  un servicio es justo lo que una cocina no puede permitirse.
- **El interruptor se mueve antes de que el servidor responda** y **vuelve atrás** si el
  `PATCH` falla, con el mensaje del backend debajo de **esa** fila.
- **Buscador** (ignora acentos y mayúsculas: `jalapeno` encuentra `Jalapeño`) y filtro
  **Solo agotados**, que es la vista para empezar el turno reponiendo.
- **En vivo**: el evento `ingrediente:disponibilidad` ([EVENTS.md §5.3](../socket-server/EVENTS.md))
  actualiza el panel abierto, así que dos pantallas de cocina no se contradicen. Llega por
  el socket que **ya** tiene el tablero; no se abre una segunda conexión.
- **Área táctil de 56 px** por fila, para usarlo con guantes. El estado nunca se dice solo
  con color: va el texto (`Disponible` / `Agotado`) y un icono.
- **Teclado**: `Enter`/`Espacio` en el interruptor, `Esc` cierra, el tabulador no se escapa
  del cajón y al cerrar el foco **vuelve** al botón de la cabecera.
- Respeta `prefers-reduced-motion`: sin él, el cajón entra deslizándose; con él, aparece.

El botón **se ve siempre**, también sin socket: el `PATCH` va por HTTP y agotar algo
funciona igual. Lo que se pierde sin tiempo real son los cambios de **otras** pantallas, y
de eso avisa el propio panel. Al reconectar, el panel **vuelve a leer la carta**, porque
los eventos que se perdieron mientras estuvo caído no se reenvían.

Toda la decisión está en [`src/lib/agotados.js`](src/lib/agotados.js) y se prueba en
[`tests/agotados.test.js`](tests/agotados.test.js); [`src/lib/useAgotados.js`](src/lib/useAgotados.js)
solo se queda con los efectos.

**Todo va por `id_ingrediente`, nunca por nombre.** En la carta hay nombres repetidos a
propósito: la "Panceta Crujiente" del seed son **dos** ingredientes distintos, en dos pasos
distintos, y agotar uno no agota el otro. Contar o agrupar por nombre los fusionaría y
apagaría el equivocado, que en una cocina significa servir algo que no hay.

## Limitaciones

- **Un plato entero no disponible esconde sus ingredientes del panel.** `GET /menu` solo
  devuelve platos con `disponible = true`, así que si un plato está apagado, sus
  ingredientes no aparecen y no se pueden reponer desde aquí. Es la **única** fuente que el
  rol `cocina` puede leer: `GET /platos/:id/pasos` es de `admin`, `cajero` y `mesero`, y a
  `cocina` le responde 403. Mientras tanto, el interruptor del plato está en el panel de
  administración. Si llega a estorbar, el arreglo es del backend (abrir esa ruta a `cocina`
  o añadir un `GET /ingredientes`), no del KDS.
- **El panel no agota platos ni pasos.** Los platos son de `admin`; y un paso no se agota
  porque `pasos_constructor` no tiene columna `disponible`: lo que se apaga son las
  opciones, no la pregunta.
- **No hay historial** de quién agotó qué: no existe endpoint ni columna.
- Un `order:status` de un pedido que no está en pantalla **no** crea una tarjeta: ese
  payload no trae los ítems, y una comanda sin ítems no le sirve a la cocina. La siguiente
  recarga lo pone en su sitio.

## Stack

React 19 · Vite 8 · react-router-dom 7 · socket.io-client 4.8 · Tailwind CSS v4
(`@tailwindcss/vite`) · lucide-react · oxlint. JavaScript, sin TypeScript.

Tipografía **Barlow Condensed** (títulos, cifras, botones) y **Barlow** (texto),
autoalojadas con `@fontsource`: una cocina puede quedarse sin internet y la pantalla tiene
que arrancar igual, así que no se piden a ningún CDN.

El fondo del login y del tablero es `public/fondo-cocina.jpg`, con un degradado debajo que
se ve mientras la imagen carga o si no llega a cargar. La foto se usa en los **dos temas**;
lo que cambia es el color del velo: oscuro en el tema oscuro, blanco en el claro — nunca al
revés, porque una capa oscura sobre el tema claro ensucia la imagen y deja el texto oscuro
flotando sobre un gris indeciso.

La intensidad se toca en un solo sitio, en [`src/index.css`](src/index.css): son el
porcentaje de velo que se mezcla sobre la foto (`0%` = foto intacta, `100%` = foto tapada).

| Variable | Oscuro | Claro | Dónde |
|---|---|---|---|
| `--capa-fondo-tablero` | `55%` | `0%` | Toda la pantalla del tablero |
| `--capa-fondo-login` | `82%` | `0%` | Solo detrás del texto del login, no en toda la foto |
| `--fondo-texto-login` | `transparent` | `rgb(255 255 255 / .85)` | Fondo propio del bloque de texto del login |

**En el tema claro la foto va sin velo**: se ve tal cual. Puede hacerse porque en el tablero
no hay un solo texto encima de la imagen — cabecera, encabezados de columna, tarjetas y la
caja del vacío llevan todos fondo sólido. Para volver a velarla basta subir esos `0%`.

En el login la foto se ve casi limpia en los dos temas: lo único que se lee encima de ella es
el titular y la barra de arriba (`.velo-texto` y `.velo-barra`). En oscuro les basta el velo
degradado; en claro, sin velo, el texto oscuro caería sobre las zonas oscuras de la foto a
1,1:1, así que ese bloque —y solo él— se trae su propio fondo con `--fondo-texto-login`.

Los valores no son estéticos sino el mínimo que sostiene el contraste: medidos contra las
zonas más clara (luminancia 250) y más oscura (5) de la foto, todo el texto queda por encima
de 4,5:1, y 3:1 el texto grande. Por eso el titular del login usa `--color-marca-sobre-foto`,
un rojo un punto más luminoso: el de marca se queda en 2,5:1 sobre el velo oscuro. Si cambias
cualquiera de estos valores, vuelve a comprobarlo.

> ⚠️ **Licencia de la imagen.** `public/fondo-cocina.jpg` es una foto de banco **con marca
> de agua**, usada aquí solo con fines académicos. Hay que reemplazarla por una imagen con
> licencia (o propia) antes de cualquier publicación real del proyecto.
