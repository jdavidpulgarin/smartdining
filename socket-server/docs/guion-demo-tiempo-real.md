# Guion de la demo: tiempo real (2 minutos)

Para la sustentación. Presenta Roberto; una segunda persona maneja los
celulares. Todo ocurre en producción (`https://app.<dominio>`), o en local si
falla la red (ver [plan B](#plan-b-si-falla-la-red)).

## Antes de empezar (10 minutos antes)

| Qué | Cómo comprobarlo |
| :--- | :--- |
| Servicios sanos | `curl https://rt.<dominio>/health` → `"estado":"ok"` y `"redis":"conectado"` |
| Tablet de la mesa 5 con la pantalla del QR abierta | Muestra un QR y no un error |
| Panel abierto en el portátil (`https://staff.<dominio>`) con sesión de mesero | La mesa 5 aparece **libre** |
| 3 celulares con datos móviles (no el Wi-Fi del salón) y la batería cargada | Ninguno tiene sesión vieja: borrar los datos del sitio |
| Pagos en **sandbox** (`WOMPI_API_URL=https://sandbox.wompi.co/v1`) | La llave pública empieza por `pub_test_` |
| Una foto del QR de la mesa 5 tomada **antes** de abrirla (el "QR viejo") | Guardada en el celular 1 |
| La pantalla del portátil se proyecta con los logs: `docker compose … logs -f socket-server` | Se ven líneas JSON |

Tarjetas de prueba de Wompi (sandbox): `4242 4242 4242 4242` aprobada,
`4111 1111 1111 1111` rechazada, con cualquier fecha futura y CVC
([docs/pagos-sandbox.md](pagos-sandbox.md)).

## El guion

| Tiempo | Pantalla | Acción | Qué decir |
| :--- | :--- | :--- | :--- |
| 0:00 | Tablet | El mesero abre la mesa 5 desde el panel. El QR de la tablet cambia solo. | "El mesero abre la mesa y el QR aparece en la tablet. Va firmado con HMAC y caduca." |
| 0:15 | Tablet | Esperar la rotación (o rotarlo desde el panel). | "Mientras nadie se sienta, el QR rota cada 3 minutos: una foto vieja no sirve." |
| 0:25 | Celular 1 | Escanear la **foto del QR viejo**. | "Aquí está la prueba: el servidor lo rechaza." (*sesión no válida*) |
| 0:35 | Celulares 1, 2 y 3 | Escanear el QR actual. Alias: Ana, Beto, Caro. | "Tres personas en la mesa. El panel las ve llegar en vivo." (señalar `mesa:presencia`) |
| 0:50 | Celulares | Ana arma un bowl con pollo **extra**; Beto agrega una limonada; Caro quita algo. | "Es un carrito compartido. Cada cambio aparece en los tres celulares en menos de un segundo, y si se cae la red y se reenvía, no se duplica." |
| 1:05 | Celular 1 | Enviar el pedido. Mostrar el KDS o el panel. | "La comanda llega a cocina. El precio lo calcula la base, no el celular." |
| 1:15 | Panel | Marcar el pedido como **listo**. | "Solo a Ana le llega '¡Tu plato está listo!', porque el plato es suyo." |
| 1:25 | Celulares 1 y 2 | Pagar en **partes iguales**. Ana con la tarjeta aprobada; Beto con la rechazada y luego con la aprobada. | "Cada uno paga su parte. El monto lo decide el servidor, Wompi lo confirma, el servidor lo vuelve a verificar con Wompi y solo entonces se anuncia." |
| 1:45 | Celular 3 | Caro paga el resto. | "Con el último pago el saldo llega a cero…" |
| 1:50 | Todo | Los tres celulares muestran "La mesa se cerró"; el panel pinta la mesa libre; la tablet sigue conectada. | "…y la mesa se libera sola: el QR y las sesiones de este grupo ya no sirven para nada." |
| 2:00 | Celular 1 | Recargar la página. | "Si alguien intenta volver con la sesión vieja, el servidor lo rechaza." Fin. |

### Preguntas probables

- **"¿Y si dos personas editan el carrito a la vez?"** El carrito se actualiza
  de forma atómica en Redis (WATCH/MULTI) con número de versión; los clientes
  descartan los snapshots viejos.
- **"¿Se puede pagar menos cambiando el JavaScript?"** No. El cliente solo manda
  el modo de pago. El servidor calcula el monto, firma la intención y, al recibir
  el webhook, compara el monto exacto con lo que devuelve la API de Wompi.
- **"¿Qué pasa si se reinicia el servidor?"** El estado vive en Redis: el
  carrito sigue ahí, y el cierre es ordenado: espera los acks en curso antes de
  apagarse (prueba manual en el [README](../README.md#persistencia-con-redis)).
- **"¿Cuánto aguanta?"** 80 comensales en 20 mesas, sin errores: p95 del ack de
  66 ms con Redis real (21 ms en memoria) en GitHub Actions, y entre 109 y 133 ms
  en un portátil modesto ([informe-carga.md](informe-carga.md)).

## Dependencias de esta demo

Partes que necesitan código de otros integrantes. Si no está fusionado el día de
la demo, se usa la alternativa:

| Momento | Depende de | Alternativa |
| :--- | :--- | :--- |
| QR que rota solo | Backend: `POST /api/mesas/:id/token-qr/interno` (Daniel, [rotacion-qr.md](rotacion-qr.md)) | Rotar a mano desde el panel (`POST /api/mesas/:id/rotar-qr`, rama `feature/mesas-rotar-qr`) |
| Pago dividido | Backend: cuenta de la mesa (§8.2) y registro de pagos (§8.4 de [EVENTS.md](../EVENTS.md)) | Plan B, paso 3 |
| Mesa liberada al pagar | Backend: liberar al llegar a saldo 0 | El mesero libera la mesa desde el panel: mismo efecto en vivo |
| "Tu plato está listo" solo al dueño | Backend: `comensal` en cada ítem de `order:created` | Llega igual por las líneas del carrito (`order:status` lo ve toda la mesa) |

## Plan B (si falla la red)

1. **Sin Internet en el salón:** compartir datos desde un celular y conectar el
   portátil y los tres celulares a ese punto de acceso. La demo es la misma.
2. **Sin el VPS:** en el portátil, `docker compose up -d` y los servicios en
   local ([README raíz](../../README.md#-levantar-smartdining-en-5-minutos)).
   Los celulares entran por `http://<ip-del-portátil>:5173` en la misma red.
   Sin HTTPS no hay push ni instalación de la PWA: se muestra el aviso dentro de
   la página, que es el mecanismo principal.
3. **Sin Wompi o sin backend de pagos:** correr las pruebas en vivo, que cubren
   las 6 capas contra dobles (sin red):

   ```bash
   cd socket-server
   node --test tests/pagos-intencion.test.js tests/pagos-webhook.test.js tests/pagos-registro.test.js
   ```

   Mostrar los nombres de las pruebas: checksum inválido, monto distinto,
   duplicado, backend caído (responde 503 y no anuncia nada), DECLINED y ERROR.
4. **Sin nada:** proyectar los [diagramas de secuencia](../README.md#diagramas-de-secuencia)
   y contar el mismo guion sobre ellos.
