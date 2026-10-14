# Despliegue en producción (VPS)

SmartDining corre en un solo VPS con Docker Compose. Este documento cubre la
primera instalación, los despliegues automáticos desde GitHub y la operación
diaria. Para desarrollo local, ver el [README](../README.md#-levantar-smartdining-en-5-minutos).

## Arquitectura

```
Internet ──► :80 / :443  nginx ──┬─► app.DOMINIO     PWA del comensal (estático)
                                 ├─► staff.DOMINIO   panel del restaurante (estático)
                                 ├─► cocina.DOMINIO  pantalla de cocina (estático, provisional)
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

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

> Docker publica puertos saltándose `ufw`. Por eso el compose no publica nada
> salvo nginx: no confíes en el firewall para ocultar un puerto publicado.

### SSH y fail2ban

Nada se opera como `root`. Antes de cerrar la sesión de root, confirma que
entras con tu usuario y tu llave (ver 2.1), y luego:

```bash
# /etc/ssh/sshd_config.d/10-smartdining.conf
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

```bash
sudo systemctl reload ssh
sudo apt install -y fail2ban unattended-upgrades
sudo tee /etc/fail2ban/jail.local > /dev/null <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
EOF
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd      # debe listar la cárcel sshd activa
```

`unattended-upgrades` instala solo los parches de seguridad de Ubuntu.

## 2. Primera instalación

### 2.1 Usuario de despliegue y código

```bash
sudo adduser --disabled-password deploy
sudo usermod -aG docker deploy
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
workflow **Deploy** entra por SSH al VPS, deja el clon en ese commit exacto y
corre `docker compose up -d --build --wait`. Si algún servicio no queda
*healthy* en 3 minutos, el despliegue falla en rojo. También se puede lanzar a
mano: Actions → Deploy → Run workflow.

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

### Respaldo de la base

```bash
mkdir -p ~/respaldos
dc exec -T postgres pg_dump -U smartdining -d smartdining -Fc > ~/respaldos/smartdining-$(date +%F).dump
```

Para hacerlo a diario, en `crontab -e` del usuario `deploy` (en cron hay que
escapar los `%`):

```
0 4 * * * cd ~/smartdining && docker compose -f docker-compose.prod.yml --env-file infra/.env exec -T postgres pg_dump -U smartdining -d smartdining -Fc > ~/respaldos/smartdining-$(date +\%F).dump && find ~/respaldos -name '*.dump' -mtime +14 -delete
```

Copia los respaldos fuera del VPS con cierta frecuencia: si el VPS se pierde,
los respaldos que estaban en él se pierden con él.

Restaurar (sobrescribe los datos actuales):

```bash
dc exec -T postgres pg_restore -U smartdining -d smartdining --clean --if-exists < ~/respaldos/ARCHIVO.dump
```

### Cambios de esquema

`00_ejecutar_todo.sql` corre **solo** con el volumen vacío. En una base que ya
tiene datos, cada script nuevo de `database/scripts/` se aplica a mano después
del despliegue (y con un respaldo recién hecho):

```bash
dc exec -T postgres psql -v ON_ERROR_STOP=1 -U smartdining -d smartdining < database/scripts/NN_nuevo.sql
```

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
