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
| `npm test` | `node --test` sobre la lógica del tablero (`src/lib/comandas.js`) |

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
| En preparación | **Listo** | `listo` |
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
hace semanas (19.000 min) y un número de cinco dígitos no informa de nada. El nivel **no
se señala solo con color**: lleva signo (`•`, `!`, `!!`) y texto ("En tiempo", "Va lenta",
"Retrasada"), por si el monitor está mal calibrado o quien mira no distingue rojo de ámbar.

**Detalle del plato.** El alias del comensal aparece como etiqueta junto al plato, y los
ingredientes van agrupados por paso del constructor, en ese orden, marcando **EXTRA** y
**LIGERA**; `normal` no se adorna, que es la que no sorprende. Un plato sin ingredientes se
ve como siempre.

**Sonido, pantalla y tema.**

- Aviso sonoro con Web Audio (dos tonos cortos, sin archivos) **solo cuando entra una
  comanda nueva por `order:created`** — nunca al recargar ni al reconectar. Los navegadores
  bloquean el audio sin un gesto previo, así que hay un botón **Activar sonido** y la
  elección se recuerda en `localStorage`.
- Botón de **pantalla completa** (Fullscreen API), con su salida.
- **Oscuro por defecto**, con interruptor claro/oscuro recordado. `prefers-color-scheme`
  solo decide la primera vez, si nadie eligió todavía.

Todas las preferencias leen y escriben `localStorage` dentro de `try/catch`: si está
bloqueado, el KDS funciona igual y solo se pierde recordar la elección.

## Limitaciones

- **El panel de agotados es D-10**, todavía no está.
- Un `order:status` de un pedido que no está en pantalla **no** crea una tarjeta: ese
  payload no trae los ítems, y una comanda sin ítems no le sirve a la cocina. La siguiente
  recarga lo pone en su sitio.

## Stack

React 19 · Vite 8 · react-router-dom 7 · socket.io-client 4.8 · Tailwind CSS v4
(`@tailwindcss/vite`) · lucide-react · oxlint. JavaScript, sin TypeScript.
