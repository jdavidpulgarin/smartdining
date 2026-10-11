# Informe de carga del socket-server

**Pregunta:** ¿aguanta el tiempo real de SmartDining un restaurante lleno?
**Escenario:** 20 mesas × 4 comensales = **80 celulares conectados a la vez**. Cada comensal
hace 5 cambios en el carrito compartido (`cart:update`) y cada cambio llega en vivo a los otros
3 de su mesa (`cart:updated`).
**Meta:** p95 de la latencia del ack **por debajo de 300 ms**, **sin errores** y todos los
avisos entregados.

**Resultado: cumple.** p95 entre **109 y 133 ms** en las 4 corridas, 0 errores y 1200/1200
avisos entregados en cada una.

## Cómo se midió

- Script: [`tests/carga/carga.js`](../tests/carga/carga.js) (`npm run carga`), con
  `socket.io-client`.
- **ack**: desde que el comensal emite `cart:update` hasta que recibe la confirmación del
  servidor (lo que el usuario percibe como "se guardó").
- **broadcast**: desde esa emisión hasta que **cada uno** de los otros 3 comensales de la mesa
  recibe el `cart:updated` con el mismo `eventId` (lo que ven los demás en su pantalla).
- Los 80 comensales envían a la vez; cada uno manda sus 5 cambios en serie.
- Fecha: 11 de octubre de 2026. Equipo: Windows 10 x64, Node 24.21. Sin Docker ni Redis en esa
  máquina, así que el almacén fue **memoria**. El script también corre con
  `REDIS_URL=...` (ver "Pendiente").

## Resultados

### Latencia del ack (ms)

| Corrida | Modo | p50 | p95 | p99 | Máx. |
|---|---|---:|---:|---:|---:|
| 1 | servidor y clientes en el mismo proceso | 82,4 | 117,3 | 126,7 | 127,7 |
| 2 | servidor y clientes en el mismo proceso | 86,9 | 111,1 | 121,5 | 122,7 |
| 3 | servidor y clientes en el mismo proceso | 93,7 | 132,5 | 140,8 | 141,8 |
| 4 | servidor aparte (`node server.js`) | 73,3 | **108,9** | 125,6 | 135,1 |

### Latencia del broadcast a los demás comensales (ms)

| Corrida | p50 | p95 | p99 | Máx. | Entregados |
|---|---:|---:|---:|---:|---:|
| 1 | 82,0 | 117,2 | 126,7 | 127,6 | 1200 / 1200 |
| 2 | 86,7 | 111,1 | 121,5 | 122,5 | 1200 / 1200 |
| 3 | 93,4 | 132,8 | 140,8 | 141,7 | 1200 / 1200 |
| 4 | 72,0 | 109,4 | 118,0 | 134,7 | 1200 / 1200 |

### Volumen y memoria

| Corrida | Conexión + `join:table` de 80 sockets | 400 `cart:update` | Eventos/s | Errores |
|---|---:|---:|---:|---:|
| 1 | 722 ms | 455 ms | 879 | 0 |
| 2 | 715 ms | 449 ms | 891 | 0 |
| 3 | 713 ms | 518 ms | 772 | 0 |
| 4 | 5 696 ms* | 348 ms | 1 149 | 0 |

\* En la corrida 4 los JWT se generan con `npm run token:comensal` (un proceso por mesa), y
eso es lo que tarda; no es el servidor.

Memoria del proceso (corridas 1 a 3, servidor **y** 80 clientes juntos): RSS de ~87 MB a
~116 MB y heap de ~22 MB a ~38–45 MB. El servidor solo ocupa una parte de eso.

## Lectura de los números

- **Margen sobre la meta:** el peor p95 (132,8 ms) queda en menos de la mitad del límite de 300 ms.
- **El ack y el broadcast valen lo mismo:** el servidor avisa a los demás en el mismo paso en
  que confirma, sin una cola intermedia.
- **Las latencias son pesimistas:** los 80 clientes disparan a la vez y, en las corridas 1 a 3,
  comparten el mismo hilo de Node con el servidor. Casi todo el tiempo es espera en esa cola,
  no trabajo del servidor. Con el servidor en su propio proceso (corrida 4) el p95 baja a 109 ms.
- **Los límites de robustez no estorbaron:** 5 cambios por comensal quedan muy por debajo de
  20 eventos/s por socket, y 4 comensales por mesa quedan por debajo de capacidad + 4.

## Pendiente

- **Repetir con Redis** (`docker compose up -d redis` y luego
  `REDIS_URL=redis://localhost:6379 npm run carga`). Con Redis, cada `cart:update` hace una
  transacción WATCH/MULTI. Se espera un poco más de latencia por la ida y vuelta a Redis,
  sin cambiar la conclusión. Hay que medirlo antes de la sustentación.
- Medir en el VPS de producción, detrás de Nginx y con TLS.

## Cómo repetirla

```bash
cd socket-server
npm run carga                                        # en memoria
REDIS_URL=redis://localhost:6379 npm run carga       # con Redis
CARGA_URL=http://localhost:4001 npm run carga        # contra un servidor ya levantado (usa su .env)
CARGA_MESAS=40 CARGA_SALIDA=resultado.json npm run carga
```

El script sale con código 1 si hay errores, si falta algún broadcast o si el p95 del ack
supera 300 ms. Así sirve también como prueba automática.
