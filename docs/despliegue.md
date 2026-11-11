# Despliegue en producción (VPS)

SmartDining corre en un solo VPS con Docker Compose. Este documento cubre la
primera instalación, los despliegues automáticos desde GitHub y la operación
diaria. Para desarrollo local, ver el [README](../README.md#-levantar-smartdining-en-5-minutos).

## Arquitectura

```
Internet ──► :80 / :443  nginx ──┬─► app.DOMINIO     PWA del comensal (estático)
                                 ├─► staff.DOMINIO   panel del restaurante (estático)
                                 ├─► cocina.DOMINIO  pantalla de cocina (estático: frontend-kds)
                                 ├─► api.DOMINIO  ──► backend:4000
                                 └─► rt.DOMINIO   ──► socket-server:4001 (WebSocket, QR, push, pagos)

red "datos" (interna, sin Internet): postgres:5432, redis:6379
```

| Pieza | Archivo |
| :--- | :--- |
| Servicios, redes y volúmenes | [`docker-compose.prod.yml`](../docker-compose.prod.yml) |
| Variables y secretos (plantilla) | [`infra/.env.example`](../infra/.env.example) |
| Imágenes de backend y socket-server | [`infra/docker/`](../infra/docker/) |
| Nginx + frontends compilados | [`infra/nginx/`](../infra/nginx/) |
| Preparar un VPS nuevo | [`infra/scripts/preparar-servidor.sh`](../infra/scripts/preparar-servidor.sh) |
| Primer certificado HTTPS | [`infra/scripts/primer-certificado.sh`](../infra/scripts/primer-certificado.sh) |
| Despliegue automático | [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) |

Reglas que no se rompen:

- Solo nginx publica puertos. Postgres y Redis no son alcanzables desde fuera.
- `/internal/*` y `/api/internal/*` responden 404 desde Internet; solo se usan
  entre contenedores.
- Ningún secreto va a un frontend: lo `VITE_*` termina en el JavaScript público.
- `infra/.env` vive solo en el VPS (permisos 600) y nunca se sube al repositorio.

## 1. Requisitos

- VPS Linux (Ubuntu 24.04 o similar), **2 GB de RAM** como mínimo: compilar los
  frontends en el VPS consume memoria. Con 1 GB, agrega 2 GB de swap.
- Docker Engine con el plugin `compose` (v2.17 o más reciente, por `--wait`).
- Un dominio con estos registros DNS **A** (y AAAA si hay IPv6) apuntando al VPS:
  `DOMINIO`, `app.`, `staff.`, `cocina.`, `api.` y `rt.`.
- Firewall: abiertos solo 22, 80 y 443.

Todo lo que no es la aplicación (usuarios, SSH, firewall, fail2ban, Docker) lo
deja listo [`preparar-servidor.sh`](../infra/scripts/preparar-servidor.sh), en
la siguiente sección.

## Preparar el servidor

Se hace **una vez** por VPS, antes de la primera instalación. El script es
idempotente: si se corta o se vuelve a correr, deja el mismo resultado. No
lleva secretos ni IPs; solo recibe tu llave **pública**.

Desde tu máquina, con el VPS recién creado y entrando como `root` con tu llave:

```bash
ssh root@IP_DEL_VPS 'bash -s -- "$(cat ~/.ssh/id_ed25519.pub)" roberto' \
  < infra/scripts/preparar-servidor.sh
```

> En Windows usa `C:\Windows\System32\OpenSSH\ssh.exe` (es el que lee el
> `ssh-agent` de Windows). Si el VPS ya tiene tu usuario, córrelo con `sudo`.

| Paso | Qué deja |
| :--- | :--- |
| 1. Sistema base | Paquetes al día; `ufw`, `fail2ban`, `unattended-upgrades`; zona `America/Bogota`; hostname `smartdining`; 2 GB de swap **solo si no hay swap** (Vultr ya trae `/swapfile`); `vm.swappiness=10`. |
| Actualizaciones | Solo parches de **seguridad**, con `Automatic-Reboot "false"`: el servidor nunca se reinicia solo (por ejemplo, durante la feria). |
| 2. Usuarios | `roberto`: sudo sin contraseña, entra solo con llave. `deploy`: sin contraseña y **sin sudo**, en el grupo `docker`; su llave se agrega en 3.1. Borra `linuxuser` (el usuario con sudo que trae la imagen de Vultr) si existe y no tiene procesos ni crontab; otro nombre con `USUARIO_NUBE=...`. |
| 3. SSH | `/etc/ssh/sshd_config.d/00-smartdining.conf`: sin root, sin contraseñas, `MaxAuthTries 3`, `AllowUsers roberto deploy`. |
| 4. Firewall | UFW: entrante denegado salvo 22, 80 y 443. fail2ban: cárcel `sshd` (backend systemd, 5 intentos en 10 min → 1 h de bloqueo). |
| 5. Docker | Docker Engine + `compose` del repositorio **oficial** de Docker (no `docker.io`), habilitado al arranque, logs rotados (10 MB × 3). |

**Por qué `00-`**: en `sshd_config` gana el **primer** valor que se lee, y las
imágenes de nube traen `50-cloud-init.conf` o `50-cloudimg-settings.conf` con
`PasswordAuthentication yes`. Con `00-`, lo nuestro se lee primero.

### Anti-bloqueo (no te saltes esto)

Cuando el script cambia la configuración de SSH, programa una **reversión
automática en 10 minutos**. Sin cerrar la sesión actual:

```bash
# 1. En una terminal NUEVA: tu usuario entra y tiene sudo
ssh roberto@IP_DEL_VPS "sudo -n true && echo sudo-ok"
# 2. Solo si eso funcionó, cancela la reversión
ssh roberto@IP_DEL_VPS "sudo systemctl stop sd-revert-ssh.timer"
# 3. root ya no entra
ssh root@IP_DEL_VPS true      # Permission denied (publickey)
```

Si el paso 1 falla, no hagas nada: a los 10 minutos se borra
`00-smartdining.conf` y vuelves a entrar como antes.

### Comprobar

```bash
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|kbdinteractive|allowusers'
sudo ufw status verbose
sudo fail2ban-client status sshd
docker run --rm hello-world
ls /var/run/reboot-required   # si existe, reinicia cuando convenga (el script no reinicia)
```

Para no escribir la IP, en tu `~/.ssh/config`:

```
Host smartdining
    HostName IP_DEL_VPS
    User roberto
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

### ⚠️ Docker se salta UFW

Docker escribe sus propias reglas de iptables, y un puerto publicado con
`ports:` queda abierto a Internet **aunque UFW diga lo contrario**. Por eso:

- en `docker-compose.prod.yml`, **Postgres (5432) y Redis (6379) no publican
  puertos al host**: solo se alcanzan por la red interna `datos`;
- el único servicio con `ports:` es nginx (80 y 443);
- si alguna vez necesitas entrar a Postgres desde tu máquina, publica en
  `127.0.0.1:5432:5432` y usa un túnel (`ssh -L 5432:127.0.0.1:5432 smartdining`),
  nunca `5432:5432`.

No confíes en el firewall para ocultar un puerto publicado.

### ⚠️ `deploy` en el grupo `docker` equivale a root

`deploy` no tiene sudo, pero quien controla Docker controla el servidor: puede
levantar un contenedor que monte `/` del host y hacer en él lo que quiera.
Trata cualquier acceso como `deploy` igual que un acceso como root. Se
mitiga así:

- **Solo se entra con llave**: sin contraseñas ni root, y
  `AllowUsers roberto deploy` (paso 3 de la preparación).
- **La llave de CI de staging lleva `restrict`** en `authorized_keys`: sin
  terminal ni reenvíos (6.4). No limita los comandos, así que la privada vive
  solo en los secretos de GitHub y se borra del runner al terminar.
- **El environment `staging` solo acepta la rama `develop`**: un PR o una rama
  cualquiera no recibe `VPS_SSH_KEY` (6.4).
- **Las guardas impiden desplegar sobre producción**: `deploy-staging.yml`
  aborta si el `.env` no es el de staging o si producción está corriendo, y
  `deploy.yml` aborta si staging está corriendo (6.1).

## 2. Primera instalación

### 2.1 Usuario de despliegue y código

El usuario `deploy` ya existe y está en el grupo `docker` (lo creó
`preparar-servidor.sh`).

```bash
sudo -iu deploy
git clone https://github.com/jdavidpulgarin/smartdining.git ~/smartdining
cd ~/smartdining && git checkout main
```

Si el repositorio es privado, agrega una *deploy key* de solo lectura
(`ssh-keygen -t ed25519 -f ~/.ssh/github_ro`) en GitHub → Settings → Deploy keys
y clona por SSH.

### 2.2 Variables

```bash
cp infra/.env.example infra/.env && chmod 600 infra/.env
nano infra/.env
```

- `DOMINIO` y `CERTBOT_EMAIL`: los reales.
- Cada secreto (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`,
  `INTERNAL_API_KEY`, `QR_SECRET`) generado aparte con `openssl rand -hex 32`.
  El socket-server se niega a arrancar con secretos cortos, repetidos o de ejemplo.
- Web Push: en tu máquina, `cd socket-server && npm run vapid`, y copia las dos llaves.
- Wompi: las cuatro llaves o ninguna. Para la demo, las de **sandbox**
  (ver [`socket-server/docs/pagos-sandbox.md`](../socket-server/docs/pagos-sandbox.md)).

### 2.3 Primer arranque con HTTPS

```bash
STAGING=1 SEED_DEMO=1 sh infra/scripts/primer-certificado.sh   # ensayo: certificado de prueba
sh infra/scripts/primer-certificado.sh                         # certificado real
```

En orden, el script:

1. levanta Postgres, Redis, backend y socket-server **sin nginx**: todavía no
   hay nada público. Con `SEED_DEMO=1` carga además `database/seed.sql`;
2. exige contraseñas propias para el personal (ver 2.4) y, si falta, te pide una;
3. crea un certificado temporal para que nginx pueda arrancar;
4. arranca nginx y certbot;
5. pide el certificado real a Let's Encrypt por webroot;
6. recarga nginx.

Primero haz el ensayo con `STAGING=1`: Let's Encrypt limita a 5 certificados
fallidos por hora, y un DNS mal puesto los gasta rápido. Si el ensayo funciona,
la corrida sin `STAGING` reemplaza el certificado de prueba.

Después de esto, el servicio `certbot` intenta renovar cada 12 h y nginx se
recarga cada 6 h para tomar el certificado nuevo. No hay que hacer nada más.

La primera vez, Postgres ejecuta `database/scripts/00_ejecutar_todo.sql`
(esquema, funciones, triggers, transiciones y el menú del constructor). Ese
script **no crea usuarios, mesas ni platos de ejemplo**: están en
`database/seed.sql`, que solo se carga con `SEED_DEMO=1`.

### 2.4 Contraseñas del personal (obligatorio)

Los usuarios de `database/seed.sql` traen el hash de `Admin123!`, la misma
contraseña de `backend/scripts/fijar-password-demo.sql`. El repositorio es
público, así que cualquiera puede entrar como admin con ella. Por eso **el
sitio no se publica mientras una cuenta del personal tenga una contraseña
conocida**:

- `primer-certificado.sh` no arranca nginx hasta que pase la verificación;
- el workflow Deploy la corre en cada despliegue y, si falla, **detiene nginx**
  y termina en rojo.

Una cuenta no pasa si su hash aparece en cualquier archivo del repositorio, o
si su contraseña es `Admin123!` (con cualquier sal) u otra de una lista de
contraseñas conocidas. Los inactivos también cuentan, porque se pueden
reactivar.

```bash
sh infra/scripts/passwords-demo.sh verificar        # lista las cuentas que no pasan
sh infra/scripts/passwords-demo.sh cambiar          # pide la nueva (dos veces, sin eco) y la aplica a esas cuentas
sh infra/scripts/passwords-demo.sh cambiar --todos  # la aplica a todas las cuentas
```

La contraseña nueva necesita al menos 12 caracteres, máximo 72 bytes (el
límite de bcrypt) y no puede contener `admin123`, `smartdining`, `password`
ni `123456`. Viaja por stdin, así que no queda en `ps`, en el historial ni en
el contenedor. Entrégala al equipo por un canal privado, nunca por el grupo
ni en un PR.

No cargues `seed.sql` a mano con la página ya publicada: sus usuarios
volverían a tener `Admin123!` hasta el próximo despliegue. Si lo haces, corre
`cambiar` enseguida.

### 2.5 Comprobar

```bash
curl https://api.DOMINIO/api/health     # {"status":"ok"}
curl https://rt.DOMINIO/health          # {"estado":"ok", ... redis ...}
curl -I https://api.DOMINIO/api/internal/x   # 404: lo interno no se ve desde fuera
```

Y desde un celular real: abrir `https://app.DOMINIO`, escanear el QR de una
mesa, armar un plato, pedirlo, verlo en `https://staff.DOMINIO` y recibir la
notificación de "plato listo". Push y la instalación de la PWA **solo**
funcionan con HTTPS válido.

## 3. Despliegue automático (GitHub Actions)

Al fusionar en `main`, el workflow **CI** corre sobre `main`; si pasa, el
workflow **Deploy** entra por SSH al VPS, deja el clon en ese commit exacto,
levanta Postgres y Redis, aplica las migraciones pendientes
(`database/migrar.sh`) y después `docker compose up -d --build --wait`. Si algún
servicio no queda *healthy* en 3 minutos, el despliegue falla en rojo. También
se puede lanzar a mano: Actions → Deploy → Run workflow.

Si staging (`smartdining-staging`) está corriendo, Deploy se niega y no toca
nada: ver [6. Staging](#6-staging).

### 3.1 Llave SSH solo para despliegues

En tu máquina (no en el VPS):

```bash
ssh-keygen -t ed25519 -N "" -C "github-deploy-smartdining" -f deploy_smartdining
ssh-copy-id -i deploy_smartdining.pub deploy@IP_DEL_VPS
ssh-keyscan -t ed25519 IP_DEL_VPS        # huella del servidor para VPS_KNOWN_HOSTS
```

Verifica que la huella de `ssh-keyscan` coincide con la del VPS
(`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` en el VPS). Después borra
`deploy_smartdining` de tu máquina: queda solo en GitHub.

### 3.2 Environment y secretos

GitHub → Settings → Environments → **New environment** → `produccion`.
Recomendado: *Deployment branches* = solo `main`, y *Required reviewers* si
quieres aprobar cada despliegue.

| Secreto del environment | Valor |
| :--- | :--- |
| `VPS_HOST` | IP o nombre del VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | contenido completo de `deploy_smartdining` (la privada) |
| `VPS_KNOWN_HOSTS` | la línea que imprimió `ssh-keyscan` |
| `VPS_RUTA` | `/home/deploy/smartdining` |

| Variable del environment | Valor |
| :--- | :--- |
| `DOMINIO` | el dominio (opcional: activa la comprobación externa de health) |

Los secretos de la aplicación **no** van a GitHub: siguen solo en `infra/.env`
del VPS.

## 4. Operación

Atajo para todos los comandos de esta sección (en el VPS, dentro del clon):

```bash
alias dc='docker compose -f docker-compose.prod.yml --env-file infra/.env'
```

| Tarea | Comando |
| :--- | :--- |
| Estado | `dc ps` |
| Logs de un servicio | `dc logs -f --tail=200 socket-server` |
| Reiniciar uno | `dc restart backend` |
| Desplegar a mano | `git pull --ff-only && dc up -d --build --wait` |
| Volver a un commit anterior | `git reset --hard <sha> && dc up -d --build --wait` |
| Forzar renovación HTTPS | `dc run --rm certbot renew --force-renewal && dc exec nginx nginx -s reload` |

Los logs de cada contenedor rotan solos (5 archivos de 10 MB).

### Respaldos de la base (R-18)

> El repositorio es **público**: los respaldos **jamás** van a GitHub. Viven
> fuera de los clones (`/srv/respaldos`) y `.gitignore` ignora `*.dump`.

[`infra/scripts/respaldo.sh`](../infra/scripts/respaldo.sh) hace un
`pg_dump -Fc` (ya comprimido) del postgres que esté corriendo: `smartdining` o
`smartdining-staging`. Si están los dos o ninguno, falla. Solo guarda el
archivo si `pg_dump` terminó bien, no está vacío y `pg_restore --list` lo lee
con `schema_migraciones`.

| Tipo | Cuándo | Dónde | Se conservan |
| :--- | :--- | :--- | :--- |
| `predeploy` | En cada despliegue (Deploy y Deploy staging), **antes** de `migrar.sh`. Si falla, el despliegue se aborta sin levantar el backend nuevo. | `/srv/respaldos/<proyecto>/predeploy/predeploy-AAAAMMDD-HHMMSS-<sha7>.dump` | 5 |
| `diario` | Timer `smartdining-respaldo`, 03:30 de Bogotá. Si el VPS estaba apagado, corre al arrancar. | `/srv/respaldos/<proyecto>/diario/diario-AAAAMMDD-HHMMSS.dump` | 7 |

Permisos: archivos 640 y carpetas 750, de `deploy` con el grupo `sd-respaldos`.
En ese grupo solo está el usuario `respaldos`, que los lee por SFTP. Nadie más.

#### Instalación (una vez por VPS, y otra vez si cambia `respaldo.sh` o `infra/systemd/`)

Desde la raíz de cualquier clon, con un usuario con sudo:

```bash
sudo sh infra/scripts/instalar-respaldos.sh --llave-lectura 'ssh-ed25519 AAAA... sd-respaldos-pc'
```

Crea el grupo y el usuario `respaldos` y las carpetas. Configura el SFTP de
solo lectura (`sshd_config.d/10-respaldos.conf`, con chroot en `/srv/respaldos`,
`internal-sftp -R` y la llave con `restrict`; antes de recargar comprueba que
`roberto` y `deploy` siguen entrando). Instala el timer. Sin `--llave-lectura`
hace todo menos la llave.

Mientras no esté instalado, **cada despliegue falla** en el respaldo previo con
un mensaje que remite aquí.

#### Respaldo a mano y registro

```bash
sudo systemctl start smartdining-respaldo.service     # el diario, ahora
journalctl -u smartdining-respaldo -n 20 --no-pager    # qué pasó
systemctl list-timers smartdining-respaldo.timer       # próxima corrida
sudo ls -l /srv/respaldos/*/*/
```

#### Aviso si el respaldo diario no llega (healthchecks.io)

1. En healthchecks.io crea un check con *Schedule* `Cron`, expresión
   `30 3 * * *`, zona `America/Bogota` y *Grace time* de 1 hora. Agrega los
   correos del equipo en *Integrations*.
2. Copia su *Ping URL* y guárdala en el VPS (se pega por la entrada estándar,
   así no queda en el historial):

   ```bash
   sudo sh -c 'umask 077; read -r url; printf "HEALTHCHECKS_URL=%s\n" "$url" > /etc/smartdining/respaldo.env'
   ```

`/etc/smartdining/respaldo.env` es 600 de root y **nunca** va en el repo. El
timer avisa a la URL al terminar bien y a `<URL>/fail` si falla. Si no se
avisa nada a tiempo, healthchecks.io manda el correo.

#### Copia fuera del VPS

Si el VPS se pierde, los respaldos que estaban en él se pierden con él. Una
tarea programada en el PC del responsable baja los diarios nuevos por SFTP con
el usuario `respaldos`, que solo puede leer `/srv/respaldos`: no tiene
terminal, no puede escribir y no ve nada más del servidor. La llave privada de
ese usuario solo existe en ese PC.

#### Simulacro de restauración (antes de cada release y una vez al mes)

```bash
sudo -iu deploy
cd /srv/smartdining-staging        # o ~/smartdining en producción
sh infra/scripts/simulacro-restauracion.sh                 # el diario más reciente
sh infra/scripts/simulacro-restauracion.sh /srv/respaldos/smartdining/predeploy/ARCHIVO.dump
```

[`simulacro-restauracion.sh`](../infra/scripts/simulacro-restauracion.sh)
levanta un postgres **temporal** sin red ni volumen con nombre, con la misma
imagen que el de producción. Restaura ahí el respaldo (`pg_restore
--exit-on-error`) y compara con la base en vivo la cantidad de tablas en
`public` y la cantidad y última fila de `schema_migraciones`, que deben ser
iguales. `usuarios` y `pedidos` se muestran como referencia. Al final borra
el contenedor, también si algo falla. No toca la base real.

#### Restaurar de verdad (sobrescribe los datos actuales)

1. Haz antes un respaldo del estado actual: `sudo systemctl start smartdining-respaldo.service`.
2. Pasa el simulacro con el archivo que vas a restaurar.
3. Detén lo que escribe en la base, restaura y vuelve a levantar:

```bash
dc stop backend socket-server
dc exec -T postgres pg_restore -U smartdining -d smartdining --clean --if-exists < /srv/respaldos/smartdining/diario/ARCHIVO.dump
dc up -d --wait
```

### Monitoreo externo (UptimeRobot)

Tres monitores HTTP(s) cada 5 minutos, con aviso por correo al equipo:

| Monitor | URL | Debe responder |
| :--- | :--- | :--- |
| API | `https://api.<DOMINIO>/api/health` | 2xx |
| Tiempo real | `https://rt.<DOMINIO>/health` | 2xx |
| App del comensal | `https://app.<DOMINIO>/` | 2xx |

Con `DOMINIO=staging.smartdining.com.co` hasta el cambio a producción. Ese
día se cambian las tres URL al `DOMINIO` de producción (§6.5). Mide desde fuera de
GitHub y del VPS. Además, cada despliegue comprueba lo mismo al terminar.

### Cambios de esquema

Con el volumen vacío, `database/docker-init.sh` corre `database/migrar.sh`, que
carga la línea base (`00_ejecutar_todo.sql`) y los scripts 26 en adelante. En
una base que ya tiene datos, **cada despliegue** (Deploy, Deploy staging y
`primer-certificado.sh`) corre `migrar.sh` antes de levantar el backend: aplica
solo los scripts de `database/scripts/` que falten en `schema_migraciones`, cada
uno en su propia transacción. Justo antes, el despliegue hace un respaldo
`predeploy`, y si ese respaldo falla no migra.

A mano (no publica puertos: corre dentro del contenedor de Postgres):

```bash
dc exec -T postgres sh /smartdining-db/migrar.sh
dc exec -T postgres psql -U smartdining -d smartdining -c "SELECT count(*) FROM schema_migraciones"
```

Un script ya aplicado **nunca** se edita: `migrar.sh` compara checksums y se
detiene sin aplicar nada si alguno cambió.

`dc down -v` borra la base entera. No lo uses en producción.

## 5. Problemas comunes

| Síntoma | Causa probable |
| :--- | :--- |
| `Define X en infra/.env` al arrancar | Falta esa variable obligatoria en `infra/.env`. |
| nginx reinicia en bucle: `cannot load certificate` | No hay certificado todavía: corre `primer-certificado.sh`. |
| certbot: `unauthorized` o `connection refused` | DNS que aún no apunta al VPS o puerto 80 cerrado. Ensaya con `STAGING=1`. |
| socket-server *unhealthy* | Secretos débiles o de ejemplo, o Redis caído: `dc logs socket-server`. |
| Los comensales se desconectan cada pocos minutos | Un proxy delante de nginx (Cloudflare, un balanceador) corta el WebSocket inactivo. |
| El build del VPS se queda sin memoria | Agrega swap o compila con más RAM. |
| `Pool overlaps with other one on this address space` | La subred fija `172.31.250.0/24` choca con otra red del VPS: cámbiala en `docker-compose.prod.yml` junto con la IP de nginx y `TRUST_PROXY`. |
| Los logs del socket-server muestran `172.31.250.10` como IP de todos | `TRUST_PROXY` no coincide con la IP de nginx. |
| Deploy en rojo: `Hay cuentas con contraseña conocida`; el sitio no responde | La compuerta de 2.4 detuvo nginx. En el VPS: `sh infra/scripts/passwords-demo.sh cambiar` y vuelve a lanzar Deploy. |
| Deploy: `Host key verification failed` | `VPS_KNOWN_HOSTS` no coincide con la huella actual del VPS. |
| Deploy: `Staging (proyecto smartdining-staging) está corriendo` | Apaga staging con `down` **sin** `-v` (ver 6.5) y vuelve a lanzar Deploy. |
| Deploy staging: `Producción (proyecto smartdining) está corriendo` | Es lo esperado después del cambio a producción (R-21). No arranques staging encima. |
| `Pool overlaps` justo después de apagar el otro entorno | Se apagó con `stop`: la red sigue creada. Usa `down` (sin `-v`). |
| `migrar: ERROR: estos scripts ya aplicados cambiaron` | Alguien editó un script ya aplicado. Deshaz el cambio y pon la corrección en un script nuevo. |

## 6. Staging

Staging es **la misma pila** (`docker-compose.prod.yml`) con otro dominio, otro
archivo de variables y otro nombre de proyecto de compose. Sigue la rama
`develop`.

| | Producción | Staging |
| :--- | :--- | :--- |
| Dominio | `smartdining.com.co` | `staging.smartdining.com.co` (`app.staging.…`, `api.staging.…`, etc.) |
| Rama | `main` | `develop` |
| Carpeta en el VPS | `/home/deploy/smartdining` | `/srv/smartdining-staging` |
| Variables | `infra/.env` | `infra/.env.staging` (plantilla: [`infra/.env.staging.example`](../infra/.env.staging.example)) |
| Proyecto compose | `smartdining` (`name:` del compose) | `smartdining-staging` (`COMPOSE_PROJECT_NAME` dentro de `infra/.env.staging`) |
| Workflow | `Deploy` (`deploy.yml`) | `Deploy staging` (`deploy-staging.yml`, llamado desde `ci.yml`) |
| Environment de GitHub | `produccion` | `staging` |

Volúmenes, redes y contenedores quedan como `smartdining-staging_*`: la base,
Redis y los certificados de staging no se mezclan con los de producción.

### 6.1 Staging y producción NO corren a la vez

Los dos publican 80/443 y usan la misma subred fija `172.31.250.0/24` (la IP de
nginx en la que confía `TRUST_PROXY`). Por eso:

- `Deploy staging` aborta si el proyecto `smartdining` está corriendo, y
  `Deploy` aborta si `smartdining-staging` está corriendo. Ninguno toca nada.
- Para pasar de uno a otro se apaga con **`down` SIN `-v`**: `stop` deja la red
  creada (y producción no podría crear la suya: `Pool overlaps`), y `-v`
  borraría la base y los certificados.

### 6.2 Primera instalación

Igual que la [sección 2](#2-primera-instalación), con estas diferencias:

```bash
# como un usuario con sudo
sudo install -d -o deploy -g deploy -m 750 /srv/smartdining-staging
sudo -iu deploy
git clone https://github.com/jdavidpulgarin/smartdining.git /srv/smartdining-staging
cd /srv/smartdining-staging && git checkout develop
cp infra/.env.staging.example infra/.env.staging && chmod 600 infra/.env.staging
```

En `infra/.env.staging`: los secretos se generan **en el VPS** con
`openssl rand -hex 32` (uno distinto para cada uno), las llaves VAPID también
(`npx web-push generate-vapid-keys`), y Wompi usa las llaves de **sandbox**
(`WOMPI_API_URL=https://sandbox.wompi.co/v1`). Ningún secreto se repite entre
staging y producción.

```bash
alias dcs='docker compose -f docker-compose.prod.yml --env-file infra/.env.staging'
ENV_FILE=infra/.env.staging STAGING=1 SEED_DEMO=1 sh infra/scripts/primer-certificado.sh   # ensayo
ENV_FILE=infra/.env.staging sh infra/scripts/primer-certificado.sh                         # certificado real
ENV_FILE=infra/.env.staging sh infra/scripts/passwords-demo.sh cambiar                     # si el paso 2 lo pide
```

La corrida sin `STAGING` reemplaza el certificado de prueba del ensayo (lo
reconoce por el emisor `(STAGING)`); un certificado real nunca se toca.

### 6.3 Datos de inventario de la demo (solo staging)

`database/seed_inventario_demo.sql` (insumos, stock y recetas) **no** lo carga
`SEED_DEMO` ni ningún despliegue, para que nunca llegue a producción. En
staging se carga a mano, una vez, después del primer arranque:

```bash
dcs exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < database/seed_inventario_demo.sql
```

Es idempotente: una segunda corrida no duplica stock ni recetas.

### 6.4 Despliegue automático desde `develop`

Cada push a `develop` corre el **CI**; si todos los jobs pasan, el job
`staging · desplegar` llama a `deploy-staging.yml`, que entra al VPS como
`deploy`, deja `/srv/smartdining-staging` en ese commit, migra y levanta todo
con `--wait`. Al final comprueba desde fuera `api.`, `rt.`, `app.` y `cocina.`.

No usa `workflow_run` (como `Deploy`) porque GitHub solo ejecuta `workflow_run`
y `workflow_dispatch` desde la rama por defecto (`main`). Mientras el archivo
no esté en `main`, para redesplegar a mano se vuelve a correr el último CI de
`develop`: `gh run rerun <id>`.

Lo configura el **dueño del repositorio** (requiere permisos de administrador):

| Dónde | Nombre | Valor |
| :--- | :--- | :--- |
| Variable de **repositorio** | `DEPLOY_STAGING` | `true`. Sin ella (o con otro valor) el job queda *skipped* y el CI sigue en verde: es el interruptor. |
| Environment `staging` → secreto | `VPS_HOST` | IP del VPS |
| | `VPS_USER` | `deploy` |
| | `VPS_RUTA` | `/srv/smartdining-staging` |
| | `VPS_SSH_KEY` | llave **privada** de CI para staging (ver abajo) |
| | `VPS_KNOWN_HOSTS` | línea de `ssh-keyscan -t ed25519 IP_DEL_VPS`, con la huella verificada |
| Environment `staging` → variable | `DOMINIO` | `staging.smartdining.com.co` (activa la comprobación desde fuera) |

Recomendado en el environment: *Deployment branches* = solo `develop`.

La llave de CI la genera **el dueño del repo en su máquina**: carga la privada
como `VPS_SSH_KEY` y la borra; al responsable del VPS solo le pasa la
**pública**, que se agrega a `/home/deploy/.ssh/authorized_keys` con `restrict`
delante (sin terminal ni reenvíos):

```
restrict ssh-ed25519 AAAA... github-deploy-staging
```

Para apagar el despliegue automático sin tocar nada más: borra la variable
`DEPLOY_STAGING` o ponle `false`.

### 6.5 Cambio de staging a producción (R-21)

```bash
cd /srv/smartdining-staging
docker compose -f docker-compose.prod.yml --env-file infra/.env.staging down   # SIN -v
```

Después, poner `DEPLOY_STAGING` en `false` (si no, cada push a `develop`
fallaría en la guarda) y seguir la [sección 2](#2-primera-instalación) para
producción. Para volver a staging: `down` de producción (también sin `-v`) y
`dcs up -d --wait`.
