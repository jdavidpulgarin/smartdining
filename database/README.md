# 🗄️ SmartDining — Módulo de Base de Datos Relacional (PostgreSQL)

**Líder de Base de Datos:** Jarrinson Pulgarin  
**Motor:** PostgreSQL 15+ / 16  
**Estrategia Técnica:** SQL Nativo + PL/pgSQL modular en scripts numerados (sin ORM / no Prisma)  
**Normalización:** Tercera Forma Normal (3FN) con diseño analítico optimizado  

---

## 📋 1. Descripción General del Módulo

El módulo de base de datos de **SmartDining** constituye el núcleo de persistencia, integridad y lógica transaccional de la plataforma. Ha sido diseñado específicamente para soportar alta concurrencia en salas gastronómicas, sincronización en tiempo real vía WebSockets, trazabilidad de cocina en pantallas KDS y un módulo avanzado de platos armables ("Constructor").

### Principios Arquitectónicos
1. **Lógica de Negocio en la Base de Datos:** Los cálculos críticos (totales de pedidos, recargos por porciones extra, variaciones de tiempo de preparación, validación de sesiones QR) se ejecutan mediante funciones PL/pgSQL y triggers, asegurando consistencia independientemente de los clientes conectados.
2. **Inmutabilidad Financiera:** Los precios unitarios de los platos e ingredientes solicitados se congelan al momento de emitir la orden (`precio_unitario` y `precio_aplicado`), garantizando auditoría histórica intacta frente a variaciones comerciales del menú.
3. **Seguridad y Trazabilidad:** Historial cronológico de cambios de estado, auditoría de modificaciones en datos sensibles y registro de intentos de pago fallidos (mitigación H-08).

---

## 🗂️ 2. Catálogo de Tablas del Sistema (17 Tablas)

El modelo de datos cuenta con **17 tablas relacionales**, descritas a continuación:

| # | Tabla | Propósito Principal | Llaves Foráneas Relevantes |
|---|---|---|---|
| 1 | `usuarios` | Cuentas del personal administrativo y operativo (admin, mesero, cajero, cocina) con hash bcrypt y control de estado activo. | - |
| 2 | `mesas` | Mesas físicas del restaurante, capacidad, ubicación, estado operativo y token QR rotativo (`token_qr`, `version_qr`, `expira_qr`). | - |
| 3 | `categorias` | Clasificación de productos del menú (Hamburguesas, Pizzas, Bebidas, Arma tu plato). | - |
| 4 | `platos` | Catálogo de platos con precio base, tiempo estimado de cocina, disponibilidad e indicador de personalización (`personalizable`). | `id_categoria` &rarr; `categorias` |
| 5 | `pasos_constructor` | Pasos secuenciales para configurar platos armables (ej. Base, Proteína, Salsas, Toppings) con reglas de selección mínima y máxima. | `id_plato` &rarr; `platos` |
| 6 | `ingredientes` | Opciones seleccionables dentro de cada paso del constructor con precio extra por porción, calorías y alérgenos. | `id_paso` &rarr; `pasos_constructor` |
| 7 | `pedidos` | Cabecera de comanda por mesa con código de seguimiento, sesión de comensal, estado operativo (`recibido` ... `pagado`) y `estado_pago`. | `id_mesa` &rarr; `mesas` |
| 8 | `detalles_pedido` | Ítems solicitados dentro de cada comanda con cantidad, subtotal congelado, notas especiales e identificador de línea KDS (`id_linea`). | `id_pedido` &rarr; `pedidos`, `id_plato` &rarr; `platos` |
| 9 | `detalles_ingredientes` | Desglose de ingredientes personalizados por cada plato armado, indicando porción (`normal`, `extra`, `ligera`) y recargo aplicado. | `id_detalle` &rarr; `detalles_pedido`, `id_ingrediente` &rarr; `ingredientes` |
| 10 | `transacciones` | Registro de pagos parciales o totales vinculados a pedidos, método (efectivo, tarjeta, transferencia), estado y referencia externa. | `id_pedido` &rarr; `pedidos` |
| 11 | `historial_estados` | Registro inmutable de transiciones de estado de comandas con marca temporal y usuario responsable para métricas y auditoría. | `id_pedido` &rarr; `pedidos`, `id_usuario` &rarr; `usuarios` |
| 12 | `suscripciones_push` | Endpoints y credenciales Web Push (W3C Push API) para alertar al celular del cliente o personal en tiempo real. | `id_pedido` &rarr; `pedidos`, `id_mesa` &rarr; `mesas` |
| 13 | `kds_metricas` | Auditoría de eficiencia operativa en cocina: compara el tiempo estimado contractual vs. el tiempo real de despacho por ítem. | `id_pedido` &rarr; `pedidos`, `id_detalle` &rarr; `detalles_pedido` |
| 14 | `intentos_pago_fallidos`| Registro de seguridad para detección de anomalías y prevención de ataques de fuerza bruta en pasarelas de pago (H-08). | `id_pedido` &rarr; `pedidos` |
| 15 | `token_qr_historico` | Registro histórico de hashes de tokens QR expirados o revocados por rotación periódica. | `id_mesa` &rarr; `mesas` |
| 16 | `kds_alertas` | Registro de retrasos detectados automáticamente en cocina cuando la preparación excede el tiempo estimado. | `id_pedido` &rarr; `pedidos` |
| 17 | `auditoria_cambios` | Bitácora de auditoría general (operación INSERT/UPDATE/DELETE, valores previos y nuevos en formato JSONB). | - |

---

## 📊 3. Vistas Analíticas y de Operación

PostgreSQL expone vistas optimizadas para alimentar los dashboards administrativos y la sincronización de sala:

1. **`v_ventas_diarias` (`24_vistas_reportes.sql`):**  
   Consolida por fecha el volumen de pedidos totales, pedidos completamente liquidados, ingresos totales recaudados, ticket promedio e ítems vendidos. Excluye pedidos cancelados.
2. **`v_ingredientes_top` (`24_vistas_reportes.sql`):**  
   Ranking de popularidad de ingredientes del constructor de platos. Mide solicitudes totales, porciones estándar vs. extras e ingresos recaudados por recargos adicionales.
3. **`v_platos_top` (`24_vistas_reportes.sql`):**  
   Ranking de demanda de platos por categoría, cantidad total de unidades despachadas e ingresos generados.
4. **`v_tiempos_kds` (`24_vistas_reportes.sql`):**  
   Consolida métricas de eficiencia en cocina: tiempo estimado promedio vs. tiempo real promedio y porcentaje de variación.
5. **`v_pedidos_activos` (`10_vistas.sql`):**  
   Listado de comandas activas en salón con resumen de platos y minutos transcurridos desde su creación.
6. **`v_mesas_ocupacion` (`10_vistas.sql`):**  
   Monitoreo en tiempo real del estado de cada mesa, pedidos asociados y tiempo de ocupación acumulado.

---

## 🚀 4. Guía de Ejecución y Despliegue de Scripts

Los scripts SQL están versionados secuencialmente en `database/scripts/`:

```
database/scripts/
├── 00_ejecutar_todo.sql                # Línea base CONGELADA (schema.sql, 01 a 25 y seed.sql)
├── 01_tablas_complementarias.sql       # Tablas de soporte, kds y auditoria
├── 02_funciones_pagos.sql              # Logica transaccional de cobros y validaciones
├── 03_funciones_pedidos.sql            # Creacion y actualizacion de pedidos
├── 04_funciones_mesas.sql              # Rotacion de QR y apertura de mesas
├── 05_funciones_menu.sql               # Gestion de catalogo y disponibilidad
├── 06_funciones_auditoria.sql          # Triggers de bitacora
├── 07_funciones_notificaciones.sql     # Logica Web Push
├── 08_triggers.sql                     # Triggers automaticos de recalculo
├── 09_indices.sql                      # Indices B-tree y optimizaciones
├── 10_vistas.sql                       # Vistas operativas de sala
├── 11_seed_data.sql                    # Datos semilla iniciales
├── 12_documentacion.sql                # Metadatos y comentarios embebidos
├── 13_constructor.sql                  # Modulo de constructor de platos
├── 14_seed_constructor.sql             # Semilla de prueba para platos armables
├── 15_pagos_comensal.sql               # Pagos parciales por comensal
├── 16_pagos_integracion.sql            # Conciliacion y pasarelas externas
├── 17_sesion_mesa_cuenta.sql           # Sesion de mesa y cuenta abierta
├── 18_kds_variacion_tiempo.sql         # Metricas de desviacion en cocina
├── 19_fix_h01_bloqueo_pedidos.sql      # Concurrencia optimista en comandas
├── 20_fix_h02_sesion_mesa_cuenta.sql   # Consistencia de sesion en cuenta compartida
├── 21_fix_h06_limites_pedido.sql       # Limites cuantitativos de pedidos
├── 22_fix_h03_estado_pago.sql          # Consistencia de estado_pago
├── 23_fix_h08_intentos_pago_fallidos.sql # Registro y deteccion de fuerza bruta
├── 24_vistas_reportes.sql              # Vistas analiticas para modulo de BI
├── 25_schema_migraciones.sql          # Registro de scripts aplicados (P-17); fin de la línea base
├── 26_configuracion.sql                # Configuración del local, mesas.activa e historial de precios (P-18; lo aplica migrar.sh)
├── 27_inventario.sql                   # Inventario real: insumos, recetas, reserva al pedir, devoluciones y avisos (P-19)
├── 28_aviso_insumo_agotado.sql         # Aviso stock_bajo también al llegar a 0 aunque ya estuviera bajo (G-06)
├── 29_configuracion_contacto.sql       # correo y redes (instagram, facebook, tiktok, whatsapp) del local (P-21)
├── 30_fix_auditoria_registro_id.sql    # registro_id de la auditoría = llave primaria real (en transacciones guardaba el id_pedido)
├── 31_transicion_listo_cancelado.sql   # transición listo → cancelado (lo cocinado es merma); cancelar_pedido() lee transiciones_validas
├── 32_fix_intento_pago_fallido_ambiguo.sql # borra la sobrecarga de 4 parámetros de registrar_intento_pago_fallido (hacía ambigua toda llamada de 4)
├── 33_estado_pago_al_cambiar_total.sql # estado_pago se recalcula también cuando cambia el total (al quitar un plato quedaba «parcial» con saldo 0)
├── 34_contacto_espacios_unicode.sql  # correo y redes rechazan también los espacios Unicode (U+00A0…), igual que `\s` del backend; no depende del locale
├── 35_transacciones_voucher.sql      # transacciones.voucher VARCHAR(40), opcional, solo con tarjeta débito/crédito, ^[A-Z0-9-]{1,40}$
├── 36_multicanal.sql                 # P-23: canal (mesa/para_llevar/domicilio), por_pagar, clientes, direcciones, zonas, domicilios, repartidor, pago anticipado
├── 37_refresh_rotado_en.sql          # refresh_tokens_cliente.rotado_en (ventana de gracia del contrato de #199): va con reemplazado_por, no cambia una vez puesto, reemplazo de la misma familia y cliente
├── 42_reportes_hora_bogota.sql       # T6: vistas de reportes por el día de Bogotá (no el de la sesión), lo recaudado por la fecha del pago (= «Recaudado hoy») y sin líneas canceladas
└── 43_zona_horaria_bogota.sql        # T6: ALTER DATABASE <base actual> SET timezone = 'America/Bogota' (las sesiones nuevas cuentan los días en hora de Bogotá); no toca datos
```

> El script de "menú con agotados" que se decida en la G-06 toma el número siguiente libre (38).

> **Multicanal (script 36, P-23).** Un pedido tiene `canal`: `mesa` (con mesa, como siempre),
> `para_llevar` o `domicilio` (sin mesa, con cliente registrado). Los dos últimos nacen en
> `por_pagar` (pago anticipado; la cocina no los ve) y solo salen a `recibido`
> (`registrar_pago_anticipado`) o a `cancelado` (`cancelar_por_pagar_vencidos`, a los
> `configuracion_restaurante.minutos_pago_anticipado` minutos, o `cancelar_pedido_por_pagar`):
> nunca las dos, y un pago que llega tarde queda en `pagos_por_devolver`. El envío va dentro de
> `pedidos.total` y aparte en `pedidos_domicilio.costo_envio`. Al cancelar desde `por_pagar` el
> stock vuelve (devolución). `clientes` y `refresh_tokens_cliente` no se auditan con la fila
> completa (tendrían el hash).

> **Auditoría de transacciones antes del script 30:** las filas de `auditoria_cambios` con
> `tabla_afectada = 'transacciones'` escritas antes del 30 tienen el **id del pedido** en
> `registro_id`. No se corrigen (el `hash_verificacion` de cada fila incluye `registro_id`).
> La transacción de esas filas es `COALESCE(datos_nuevos, datos_anteriores)->>'id_transaccion'`.

### ⚠️ Regla: un script aplicado NUNCA se edita

Desde P-17, cada base guarda en `schema_migraciones` qué scripts tiene aplicados y el
checksum (sha256) de cada uno. Si un script ya aplicado cambia, `migrar.sh` se detiene
con error y no aplica nada.

- **Un cambio de esquema o de función va siempre en un script NUEVO**, con el siguiente
  número libre: `26_...sql`, `27_...sql`. Para corregir una función, el script nuevo
  hace `CREATE OR REPLACE`; para cambiar una tabla, `ALTER TABLE`.
- **`00_ejecutar_todo.sql` quedó congelado** como línea base (schema, 01 a 25 y seed).
  Los scripts 26 en adelante **no** se agregan ahí: los aplica `migrar.sh`.
- Un script nuevo no lleva `BEGIN`/`COMMIT` propios: `migrar.sh` lo envuelve en una
  transacción junto con su registro. Tampoco puede usar comandos que no corren dentro de
  una transacción (`CREATE INDEX CONCURRENTLY`, `VACUUM`).
- Hazlo idempotente cuando sea razonable (`IF NOT EXISTS`, `CREATE OR REPLACE`,
  `ON CONFLICT DO NOTHING`).

### Migraciones con `migrar.sh`

`database/migrar.sh` aplica en orden los scripts de `database/scripts/` que la base aún
no tiene registrados, cada uno en **una transacción** junto con su registro: o queda
aplicado y registrado, o no queda nada. Antes de aplicar, revisa los checksums de los
que ya están aplicados.

| Situación | Qué hace |
|---|---|
| Base vacía | Corre `00_ejecutar_todo.sql` (línea base) y luego los scripts nuevos |
| Base cargada antes de P-17 (sin `schema_migraciones`) | Corre solo `25_schema_migraciones.sql`, que registra 00 a 25, y luego los nuevos |
| Base al día | Aplica solo lo que falte; si no falta nada, dice `nada que hacer` |
| Un script aplicado cambió | Error (exit 1) y **no aplica nada** |
| Un script nuevo falla | Se deshace completo, no se registra, exit 1 |

Correrlo dos veces seguidas es seguro: la segunda vez no cambia nada.

**Dentro del contenedor de Docker (recomendado, igual que en producción):**

```bash
docker compose exec -T postgres sh /smartdining-db/migrar.sh
# producción:
docker compose -f docker-compose.prod.yml exec -T postgres sh /smartdining-db/migrar.sh
```

Usa el `psql` 16 del contenedor y se conecta por el socket local con `POSTGRES_USER` y
`POSTGRES_DB`: no hace falta contraseña ni tener PostgreSQL instalado en el equipo.

> **Git Bash en Windows:** Git Bash convierte las rutas que empiezan por `/` antes de
> pasarlas a `docker`, y `/smartdining-db/migrar.sh` llega al contenedor como
> `C:/Program Files/Git/smartdining-db/migrar.sh` (`sh: can't open ...`). Desactiva esa
> conversión en la terminal antes de usar `docker compose exec`:
>
> ```bash
> export MSYS_NO_PATHCONV=1
> ```
>
> PowerShell, WSL, Linux y macOS no lo necesitan.

**Git Bash en Windows**, contra un PostgreSQL instalado en el equipo:

```bash
PSQL="/c/Program Files/PostgreSQL/18/bin/psql.exe" PGUSER=postgres PGDATABASE=smartdining \
  PGPASSWORD=<tu clave local> sh database/migrar.sh
```

No hace falta WSL. `migrar.sh` es POSIX `sh` (la imagen `postgres:16-alpine` no trae
bash) y lee la conexión de las variables estándar `PGHOST`, `PGPORT`, `PGUSER`,
`PGPASSWORD` y `PGDATABASE`. Quita los `\r` antes de calcular el checksum, así que un
checkout con CRLF no cuenta como cambio. Con `MIGRAR_SCRIPTS_DIR` se puede apuntar a otra
carpeta de scripts (solo para pruebas).

**No corras dos migraciones a la vez** sobre la misma base.

### Ejecución con Docker Compose
```bash
docker compose up -d postgres
# Con el volumen vacío, database/docker-init.sh (montado en /docker-entrypoint-initdb.d)
# corre migrar.sh: línea base + scripts nuevos, todo registrado en schema_migraciones.
# Con un volumen que ya tiene datos, docker-init.sh NO corre: usa migrar.sh (arriba).
```

### Pruebas SQL

Cada archivo de `database/tests/` es un bloque `DO` que lanza una excepción si algo falla y limpia lo que crea. Se corren sobre una base ya cargada. **Ninguna depende de que el seed traiga pedidos** (desde #182 no trae ninguno): las que los necesitan crean los suyos. `test_g07_inventario_demo.sql` sí necesita `seed_inventario_demo.sql`.

Para correrlas todas y ver cuál falla (en Git Bash, con el proyecto de Docker de pruebas):

```bash
for t in database/tests/*.sql; do
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d smartdining < "$t" >/dev/null 2>&1 \
    && echo "OK    $t" || echo "FALLA $t"
done
```

Una por una:

```bash
cd database/tests
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_p18_configuracion.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_p21_configuracion_contacto.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_30_auditoria_registro_id.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_31_listo_cancelado.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_33_estado_pago_total.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_34_contacto_espacios_unicode.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_35_voucher.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_36_multicanal.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_37_refresh_rotado.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_42_reportes_hora_bogota.sql
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_zonas_demo.sql       # carga seed_zonas_demo.sql dentro de su ROLLBACK
psql -v ON_ERROR_STOP=1 -U postgres -d smartdining -f test_43_zona_horaria.sql  # solo lectura; también la corre el CI
```

Voucher de tarjeta (script 35): `test_35_voucher.sql` crea su propia mesa, plato y pedido y
comprueba que `transacciones.voucher` es `VARCHAR(40)` opcional, que se guarda con tarjeta débito o
crédito (también se puede cobrar sin él), que efectivo, transferencia y online lo rechazan, que el
formato `^[A-Z0-9-]{1,40}$` rechaza minúsculas, espacios, vacío, 41 caracteres, punto y barra, que
no se puede pasar a efectivo una transacción con voucher y que la auditoría lo guarda. Usa `\ir`:
correrla desde `database/tests`. Corre en `BEGIN … ROLLBACK`.

Espacios Unicode en el contacto (script 34): `test_34_contacto_espacios_unicode.sql` exige que
`correo` y `redes` rechacen U+00A0, U+2003, U+3000 y U+FEFF (sin el 34, `postgres:16-alpine` los
acepta: `[[:space:]]` depende del locale), que lo de antes no cambie y que, si una fila vieja ya
tuviera uno, el script no falle y deje el CHECK `NOT VALID` hasta corregirla. Usa `\ir`: correrla
desde `database/tests`. Corre en `BEGIN … ROLLBACK`.

`estado_pago` al cambiar el total (script 33): `test_33_estado_pago_total.sql` crea su propia
mesa y plato, abona la mitad de un pedido de dos líneas y quita una: el total queda igual a lo
pagado y exige `pagado` (sin el 33 se queda en `parcial`). También comprueba que al agregar una
línea vuelve a `parcial`, que sin pagos sigue `pendiente`, que no toca el estado de cocina y que
el script corrige las filas que ya quedaron mal y es idempotente. Usa `\ir`: correrla desde
`database/tests`. Corre en `BEGIN … ROLLBACK`: no deja nada.

Pedido en `listo` que se cancela (script 31): `test_31_listo_cancelado.sql` crea su propia mesa,
insumo y plato con receta (no depende del seed) y comprueba que `listo → cancelado` se permite por
`UPDATE` y por `cancelar_pedido()`, que lo cocinado queda como merma sin devolver stock, que desde
`recibido` se sigue devolviendo y que `entregado` y `pagado` siguen sin poder cancelarse. Corre en
`BEGIN … ROLLBACK`: no deja nada.

Auditoría (script 30): `test_30_auditoria_registro_id.sql` hace INSERT, UPDATE y DELETE en
`transacciones`, `usuarios` y `platos` y exige que `registro_id` sea la llave primaria de cada
fila (10 filas). Sin el script 30 falla en las 4 de `transacciones`. Lo deshace todo, también
sus filas de auditoría.

Contacto del local (P-21, script 29): `test_p21_configuracion_contacto.sql` prueba los CHECK de
`correo` y `redes` (8 correos y 16 formas de redes que se rechazan) y deja la fila como estaba.

Inventario (P-19): `test_p19_inventario.sql` corre dentro de `BEGIN … ROLLBACK` (no deja
nada). La concurrencia y `pg_notify` necesitan `COMMIT` de verdad, así que van en un script
aparte que crea y borra sus propios datos:

```bash
sh database/tests/test_p19_concurrencia.sh          # misma conexión que migrar.sh (PG*)
PEDIDOS=50 PORCIONES=10 sh database/tests/test_p19_concurrencia.sh
docker compose exec -T postgres sh /smartdining-db/tests/test_p19_concurrencia.sh
```

Multicanal (script 36, P-23): `test_36_multicanal.sql` corre en `BEGIN … ROLLBACK`, crea sus
propios datos (usa `\ir`: correrla desde `database/tests`) y comprueba que **la mesa sigue
igual** (reserva, devolución, merma, pago, cuenta, KDS y comprobante), para llevar, domicilio
(zona por barrio, envío dentro del total, pago anticipado, repartidor), el vencimiento (el stock
vuelve) y el pago tardío o por otro monto (`pagos_por_devolver`). La carrera entre el pago y el
vencimiento o la cancelación del cliente necesita sesiones y `COMMIT` de verdad:

```bash
sh database/tests/test_36_carrera.sh                  # misma conexión que migrar.sh (PG*)
RONDAS=50 sh database/tests/test_36_carrera.sh
docker compose exec -T postgres sh /smartdining-db/tests/test_36_carrera.sh
```

Rotación de los refresh tokens de la app (script 37): `test_37_refresh_rotado.sql` corre en
`BEGIN … ROLLBACK` (usa `\ir`) y comprueba la rotación normal del contrato de #199
(`reemplazado_por` + `rotado_en`, sin tocar `revocado_en`), que los dos van juntos, que la
ventana de gracia puede cambiar el reemplazo sin mover `rotado_en`, que el reemplazo es de la
misma familia y del mismo cliente, el reuso (revocar la familia) y que el script es idempotente.

Reportes en hora de Bogotá (script 42, T6): `test_42_reportes_hora_bogota.sql` corre en
`BEGIN … ROLLBACK` con la sesión en UTC (como Docker) y días del 2031. Comprueba que una venta
de la noche cuenta en su día de Bogotá (sin el script falla aquí), que la zona de la sesión no
importa, que lo recaudado va por la fecha del pago y cuadra con las transacciones del día, que
las líneas canceladas no cuentan, que las vistas conservan columnas y tipos y que es idempotente.

Zona horaria (script 43, T6): `test_43_zona_horaria.sql` es de solo lectura y la corre también el
CI después de `migrar.sh`. Comprueba que la base tiene `America/Bogota` por defecto, que una sesión
nueva (`connect`) la toma y que `now()::date` es el día de Bogotá, y **falla si alguna columna de
una tabla de `public` es `timestamp` sin zona, `date` o `time`**. Regla: las fechas van siempre como
`TIMESTAMPTZ`, y el día se calcula con `(col AT TIME ZONE 'America/Bogota')::date`, sin depender
de la zona de la sesión.

Aviso de insumo agotado (script 28, G-06): también necesita `COMMIT` (escucha `LISTEN
inventario`), crea y borra sus propios datos (prefijo `G06A`):

```bash
sh database/tests/test_g06_aviso_agotado.sh
docker compose exec -T postgres sh /smartdining-db/tests/test_g06_aviso_agotado.sh
```

### Datos de inventario para la demo (G-07)

`database/seed_inventario_demo.sql` carga 34 insumos con su stock inicial y las recetas
de los platos y opciones de `seed.sql`. **Es solo para local, staging y la demo:** no lo
corren `docker-init.sh` ni `migrar.sh`, así que nunca llega solo a producción. Se carga
**a mano**, después de `migrar.sh` (necesita el script 27).

Lo que deja preparado:

- **Hamburguesa Smart Angus** con 4 porciones de carne Angus: el **4.º pedido** la agota
  y sale de la carta; el 5.º recibe el error de sin stock.
- **Arepa de Chócolo** (opción de la Arepa Rellena) con 2 unidades y mínimo 4: sale en
  stock bajo desde el inicio y se agota con 2 pedidos.
- **Panceta Crujiente del Bowl** sigue apagada a mano (de `seed.sql`): en la carta sale
  como `manual`, no como `stock`, para mostrar la diferencia.

Se puede correr varias veces: no duplica insumos ni recetas, y el stock inicial entra como
una `entrada` **solo** para el insumo que todavía no tiene movimientos. Una segunda
corrida no repone stock gastado (para eso está el movimiento de `entrada`).

**Local (Docker):**

```bash
docker compose exec -T postgres psql -U postgres -d smartdining -v ON_ERROR_STOP=1 \
  -f /smartdining-db/seed_inventario_demo.sql
# comprobar (BEGIN … ROLLBACK, no gasta stock):
docker compose exec -T postgres sh -c 'cd /smartdining-db/tests && psql -q -U postgres -d smartdining -v ON_ERROR_STOP=1 -f test_g07_inventario_demo.sql'
```

En Git Bash, antes: `export MSYS_NO_PATHCONV=1` (ver arriba).

#### Para Roberto: cargarlo en staging

Solo en **staging**, nunca en producción. En el servidor, desde la carpeta del proyecto
y con la rama ya desplegada:

```bash
# 1. La base al día (aplica el 27 si falta)
docker compose -f docker-compose.prod.yml exec -T postgres sh /smartdining-db/migrar.sh

# 2. Los datos de la demo (usa el usuario y la base del contenedor)
docker compose -f docker-compose.prod.yml exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /smartdining-db/seed_inventario_demo.sql'

# 3. Comprobar: debe terminar en "=== PRUEBA G-07 PASADA SATISFACTORIAMENTE ==="
docker compose -f docker-compose.prod.yml exec -T postgres sh -c \
  'cd /smartdining-db/tests && psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f test_g07_inventario_demo.sql'
```

El paso 2 debe terminar en `COMMIT` con `34 | 20 | 39 | 1` en el resumen (insumos,
recetas de plato, recetas de opción, insumos en stock bajo). La prueba del paso 3 espera
el stock recién cargado: si ya se hicieron pedidos de hamburguesa en staging, el caso 5
lo avisa y no es un fallo del seed.

**Para dejar la demo como al inicio** antes de presentarla, repón con `entrada` lo que se
gastó (por ejemplo desde la pantalla de Inventario cuando esté, o con
`SELECT registrar_movimiento_inventario(id_insumo, 'entrada', cantidad, 'Reposición demo')`),
sin borrar movimientos: el libro debe seguir cuadrando.

### Zonas de entrega para la demo

`database/seed_zonas_demo.sql` carga tres zonas activas con barrios de Cartagena, para que
la app pueda cotizar un domicilio. Sin zonas, `GET /api/v1/zonas` viene vacío y cotizar
siempre responde 422 `fuera_de_cobertura`.

| Zona | Barrios | Envío | Tiempo |
|---|---|---|---|
| Centro | Centro Histórico, Getsemaní, San Diego, La Matuna | $4.000 | 25 min |
| Bocagrande | Bocagrande, Castillogrande, El Laguito, Manga | $6.000 | 35 min |
| Norte | Crespo, Marbella, El Cabrero, Torices | $7.000 | 40 min |

**Es solo para local, staging y la demo:** como `seed_inventario_demo.sql`, no lo corren
`docker-init.sh` ni `migrar.sh`. Se carga **a mano**, después de `migrar.sh` (necesita el
script 36).

Se puede correr varias veces. Solo inserta; nunca cambia ni borra una zona. Una zona se
salta, con un `NOTICE`, si ya existe una con ese nombre o si alguno de sus barrios ya está en
otra zona activa. Así no pisa lo que haga el administrador (D-20).

`test_zonas_demo.sql` corre en `BEGIN … ROLLBACK` y carga el seed él mismo (usa `\ir`), así
que sirve en una base con o sin él. Comprueba:
- las tres zonas;
- `cotizar_zona` con cualquier escritura del barrio;
- que repetirlo no cambia nada;
- que no pisa una zona editada o desactivada;
- que salta sin error una zona cuyo barrio ya cubre otra.

`test_36_multicanal.sql` desactiva dentro de su transacción las zonas que ya existan, porque
usa barrios del Centro.

**Local (Docker):**

```bash
docker compose exec -T postgres psql -U postgres -d smartdining -v ON_ERROR_STOP=1 \
  -f /smartdining-db/seed_zonas_demo.sql
docker compose exec -T postgres sh -c 'cd /smartdining-db/tests && psql -q -U postgres -d smartdining -v ON_ERROR_STOP=1 -f test_zonas_demo.sql'
```

#### Para Roberto: cargarlas en staging

Solo en **staging**, nunca en producción. En el servidor, desde la carpeta del proyecto y con
la rama ya desplegada:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /smartdining-db/seed_zonas_demo.sql'
```

Debe decir `zona "…" creada` tres veces y terminar con la tabla de las zonas activas
(`(3 rows)` si no había otras). Para comprobarlo desde fuera:
`GET https://api.staging.smartdining.com.co/api/v1/zonas` debe traer las tres zonas.
