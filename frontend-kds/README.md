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
   pasar cosas que no llegaron, y mezclar dejaría comandas fantasma.
2. `order:created` agrega la comanda en **Nuevas**; `order:status` la mueve de columna, o
   la quita del tablero si pasa a `entregado`, `pagado` o `cancelado`.
3. Los eventos se deduplican por `eventId` (el socket-server reintenta, EVENTS.md §3.1) y
   por `id_pedido` (para no duplicar una comanda que ya estaba en pantalla).
4. Los minutos de cada tarjeta parten de `minutos_transcurridos` de la API y avanzan con
   el reloj local, refrescándose cada 30 s **sin pedir nada al servidor**.

Toda esa lógica está en [`src/lib/comandas.js`](src/lib/comandas.js) como funciones puras,
y se prueba con `npm test` sin montar React. Los efectos (pedir, conectar, reconectar)
están aparte en [`src/lib/useTablero.js`](src/lib/useTablero.js).

## Limitaciones de esta etapa (D-08)

- **La columna "Listas" se vacía al recargar.** `GET /api/kds/comandas` solo devuelve
  pedidos en `recibido` y `en_preparacion`, así que esa columna se llena únicamente con
  los `order:status` que llegan en vivo. Es una limitación conocida del endpoint, no un
  error del KDS; arreglarlo es tocar el backend y no corresponde a esta actividad.
- **Sin botones de acción.** Mover una comanda a "En preparación" o "Listo" desde la
  pantalla es **D-09**, junto con el semáforo de tiempos, el sonido de aviso y la pantalla
  completa. El panel de agotados es **D-10**.
- **`comensal` e `ingredientes` por ítem** llegan con el PR #32 (constructor de platos).
  Hasta que se fusione, el backend no los manda y las tarjetas se dibujan igual, sin
  errores; cuando lleguen, se muestran solos (el alias como etiqueta y los ingredientes
  agrupados por paso, marcando la porción cuando no es `normal`).
- Un `order:status` de un pedido que no está en pantalla **no** crea una tarjeta: ese
  payload no trae los ítems, y una comanda sin ítems no le sirve a la cocina. La siguiente
  recarga lo pone en su sitio.

## Stack

React 19 · Vite 8 · react-router-dom 7 · socket.io-client 4.8 · Tailwind CSS v4
(`@tailwindcss/vite`) · lucide-react · oxlint. JavaScript, sin TypeScript.
