# Probar pagos con Wompi en sandbox

Guía para probar de punta a punta, con dinero de mentira, el flujo de
[EVENTS.md §8](../EVENTS.md#8-pagos-wompi-sandbox): intención → widget → webhook →
reverificación → registro → `payment:confirmed`.

> Datos verificados en docs.wompi.co (octubre de 2026). Si algo cambió, gana la documentación
> de Wompi.

## 1. Llaves de prueba

1. Crea una cuenta en <https://comercios.wompi.co> y entra en **Desarrolladores**, en modo
   **pruebas (sandbox)**.
2. Copia las cuatro llaves a `socket-server/.env`. Nunca van al repositorio ni a un frontend:

   ```env
   WOMPI_PUBLIC_KEY=pub_test_...
   WOMPI_PRIVATE_KEY=prv_test_...
   WOMPI_INTEGRITY_SECRET=test_integrity_...
   WOMPI_EVENTS_SECRET=test_events_...
   WOMPI_API_URL=https://sandbox.wompi.co/v1
   BACKEND_URL=http://localhost:4000
   ```

3. `npm run dev`. Si alguna llave falta o no tiene el formato correcto, el servidor no arranca
   y dice cuál.

## 2. Exponer el webhook local con un túnel

Wompi tiene que poder llegar a `POST /pagos/webhook`. Opciones:

```bash
# cloudflared (sin cuenta, URL temporal)
cloudflared tunnel --url http://localhost:4001
# → https://<algo>.trycloudflare.com

# o ngrok
ngrok http 4001
# → https://<algo>.ngrok-free.app
```

En el panel de Wompi → **Desarrolladores** → **URL de eventos** (sandbox), pon
`https://<tu-túnel>/pagos/webhook`.

- El túnel expone **todo** el puerto 4001. `/internal/*` sigue protegido por
  `x-internal-key`, pero apaga el túnel cuando termines.
- El webhook verifica el checksum con `WOMPI_EVENTS_SECRET`. Si las llaves no coinciden con
  la cuenta, verás `webhook rechazado (checksum)` en el log y Wompi recibirá `400`.

## 3. Crear una intención

Necesitas un JWT de comensal con su alias firmado (el backend lo pone al abrir la sesión):

```bash
npm run token:comensal -- --mesa 5 --comensal Ana      # copia el token
```

Conecta un cliente (por ejemplo `examples/clienteMesa.js` o la PWA) y haz
`join:table` (el alias sale del JWT). Luego:

```bash
curl -s -X POST http://localhost:4001/pagos/intencion \
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
  -d '{"modo":"total","eventId":"'"$(node -e "console.log(crypto.randomUUID())")"'"}'
```

Responde `referencia`, `monto_en_centavos`, `moneda`, `llave_publica`, `firma_integridad` y
`expira_en`. **Mientras el backend no tenga `GET /api/mesas/:id/cuenta/interno`** (pendiente,
EVENTS.md §8.2), esta llamada responde `502`. Para probar antes, levanta un backend de mentira
que devuelva una cuenta con esa forma.

## 4. Pagar en el widget

Abre una página local con el widget y los datos de la intención (ver el ejemplo de
`WidgetCheckout` en EVENTS.md §8.1) y paga con los datos de prueba de Wompi:

| Medio | Dato | Resultado |
|---|---|---|
| Tarjeta | `4242 4242 4242 4242`, cualquier fecha futura y CVC de 3 dígitos | **APPROVED** |
| Tarjeta | `4111 1111 1111 1111`, cualquier fecha futura y CVC de 3 dígitos | **DECLINED** |
| Tarjeta | cualquier otra | **ERROR** |
| Nequi | `3991111111` / `3992222222` | APPROVED / DECLINED |

## 5. Qué deberías ver

**Tarjeta aprobada (4242…):**

1. Log: el webhook recibe `transaction.updated` con el checksum válido.
2. Se consulta `GET https://sandbox.wompi.co/v1/transactions/<id>` con la llave privada.
3. Se llama a `POST /api/transacciones/internal` del backend (**pendiente**, ver EVENTS.md
   §8.4). Mientras no exista, el backend responde `404`: el pago **no** se anuncia y llega
   `pago:alerta` con `motivo: "backend_rechazo_404"` al panel. Es el comportamiento
   correcto: nunca se anuncia un pago que no quedó registrado.
4. Con el backend listo, la mesa y el panel reciben `payment:confirmed` con `saldo_restante`.

**Tarjeta rechazada (4111…):** no se consulta la API ni se registra nada. La intención queda
`rechazada` y el comensal puede pedir otra (`POST /pagos/intencion` devuelve una referencia
nueva).

**Reintento:** apaga el backend y paga con 4242. El webhook responde `503` y no se anuncia
nada. Wompi reintenta a los 30 min, 3 h y 24 h. Al volver el backend, el siguiente reintento
registra y anuncia el pago. Para no esperar, puedes reenviar el evento desde el panel de Wompi.

## 6. Problemas comunes

| Síntoma | Causa probable |
|---|---|
| El widget dice "firma inválida" | `WOMPI_INTEGRITY_SECRET` no es el de la misma cuenta que `WOMPI_PUBLIC_KEY` |
| `webhook rechazado (checksum)` | `WOMPI_EVENTS_SECRET` equivocado, o un proxy reescribió el cuerpo |
| `webhook rechazado (timestamp)` | Reloj del servidor desfasado (más de 5 min hacia el futuro) o evento de hace más de 25 h |
| `pago:alerta` con `monto_distinto` | Alguien abrió el widget con otro monto: la firma de integridad debió impedirlo; revisa |
| `pago:alerta` con `referencia_desconocida` | La intención venció (`PAGOS_TTL_MINUTOS`) o se pagó con una referencia ajena |
