#!/bin/sh
# ==============================================================================
# SmartDining · infra/scripts/instalar-respaldos.sh (R-18)
#
# Prepara los respaldos de UN entorno del VPS. Se corre como root desde la
# raíz del clon de ese entorno y se puede repetir: no duplica nada. Vuelve a
# correrlo cuando cambie infra/scripts/respaldo.sh o infra/systemd/.
#
#   cd /srv/smartdining-staging && sudo ENTORNO=staging sh infra/scripts/instalar-respaldos.sh
#   cd /srv/smartdining && sudo ENTORNO=produccion sh infra/scripts/instalar-respaldos.sh
#   sudo sh infra/scripts/instalar-respaldos.sh --entorno staging --llave-lectura 'ssh-ed25519 AAAA... comentario'
#
# ENTORNO (variable o --entorno, OBLIGATORIO y sin valor por defecto):
#   staging    clon /srv/smartdining-staging, carpeta /srv/respaldos/smartdining-staging,
#              timer smartdining-respaldo@staging, /etc/smartdining/respaldo-staging.env
#   produccion clon /srv/smartdining, carpeta /srv/respaldos/smartdining,
#              timer smartdining-respaldo@produccion, /etc/smartdining/respaldo-produccion.env
# Cualquier otro valor, o ninguno: sale con 2 sin tocar nada.
#
# Qué hace:
#   1. Grupo sd-respaldos y usuario de sistema respaldos (sin contraseña ni
#      terminal). Es el único miembro del grupo.
#   2. /srv/respaldos (root, 755) y la carpeta del proyecto del entorno,
#      deploy:sd-respaldos 2750: deploy escribe, el grupo solo lee, nadie más
#      entra. El nombre es el del proyecto de compose (smartdining-staging o
#      smartdining): bajar-respaldos.ps1 los lista así.
#   3. SFTP de SOLO LECTURA para respaldos (sshd_config.d/10-respaldos.conf):
#      encerrado en /srv/respaldos, internal-sftp -R, sin terminal ni reenvíos.
#      Agrega respaldos a la línea AllowUsers de 00-smartdining.conf.
#      Su llave (con restrict) va en /etc/ssh/llaves-respaldos/respaldos y
#      reemplaza a la anterior. Valida con sshd -t y sshd -T (roberto y deploy
#      siguen entrando) antes de recargar; si algo no cuadra, deshace el cambio.
#   4. /etc/smartdining/respaldo-<entorno>.env (600 root) para HEALTHCHECKS_URL,
#      que NUNCA va en el repo (es público). Si ya existe, no se toca. Con
#      ENTORNO=staging y sin él, si existe el viejo respaldo.env se copia (el
#      check de staging sigue igual); el viejo no se borra.
#   5. respaldo.sh en /usr/local/lib/smartdining/ y el timer
#      smartdining-respaldo@<entorno> (03:30 de Bogotá, Persistent). Si está
#      el timer viejo sin entorno (smartdining-respaldo.timer, de antes de
#      esto, que era el de staging), con ENTORNO=staging se reemplaza; con
#      ENTORNO=produccion se detiene y pide instalar staging primero.
# ==============================================================================
set -eu

cd "$(dirname "$0")/../.."

uso() {
  echo "uso: sudo ENTORNO=staging|produccion sh $0 [--llave-lectura 'ssh-ed25519 AAAA... comentario']" >&2
  echo "     (o --entorno staging|produccion en vez de la variable)" >&2
  exit 2
}
LLAVE=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --llave-lectura) LLAVE=${2:-}; [ -n "$LLAVE" ] || { echo "falta la llave pública después de --llave-lectura" >&2; exit 2; }; shift 2 ;;
    --entorno) ENTORNO=${2:-}; if [ "$#" -ge 2 ]; then shift 2; else shift; fi ;;
    *) uso ;;
  esac
done

case "${ENTORNO:-}" in
  staging) PROYECTO=smartdining-staging RUTA=/srv/smartdining-staging ;;
  produccion) PROYECTO=smartdining RUTA=/srv/smartdining ;;
  *) echo "instalar-respaldos: ERROR: ENTORNO debe ser 'staging' o 'produccion' (recibido: '${ENTORNO:-}'). No se instaló nada." >&2; uso ;;
esac
UNIDAD=smartdining-respaldo@$ENTORNO
ENV_PRIVADO=/etc/smartdining/respaldo-$ENTORNO.env
ENV_VIEJO=/etc/smartdining/respaldo.env
TIMER_VIEJO=/etc/systemd/system/smartdining-respaldo.timer
SERVICIO_VIEJO=/etc/systemd/system/smartdining-respaldo.service

paso() { echo "==> $*"; }
fallar() { echo "instalar-respaldos: ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || { echo "instalar-respaldos: córrelo con sudo" >&2; exit 1; }

# El respaldo.sh y las unidades salen del clon de ESE entorno.
[ "$(pwd -P)" = "$RUTA" ] || fallar "ENTORNO=$ENTORNO se instala desde su clon, $RUTA (estás en $(pwd -P))"
id deploy >/dev/null 2>&1 || fallar "no existe el usuario deploy (corre antes preparar-servidor.sh)"
for f in infra/scripts/respaldo.sh 'infra/systemd/smartdining-respaldo@.service' 'infra/systemd/smartdining-respaldo@.timer'; do
  [ -f "$f" ] || fallar "falta $f: córrelo desde la raíz de un clon del repositorio"
done
# El timer viejo (sin entorno) corre /usr/local/lib/smartdining/respaldo.sh sin
# ENTORNO: en cuanto se instale el respaldo.sh nuevo, fallaría cada noche. Era
# el de staging, así que lo reemplaza ENTORNO=staging.
if [ -f "$TIMER_VIEJO" ] && [ "$ENTORNO" != staging ]; then
  fallar "está el timer viejo smartdining-respaldo.timer (el de staging): instala primero staging (cd /srv/smartdining-staging && sudo ENTORNO=staging sh infra/scripts/instalar-respaldos.sh)"
fi

# --- 1. Grupo y usuario --------------------------------------------------------
paso "1. grupo sd-respaldos y usuario respaldos"
getent group sd-respaldos >/dev/null || groupadd --system sd-respaldos
if ! id respaldos >/dev/null 2>&1; then
  useradd --system --gid sd-respaldos --home-dir /srv/respaldos --no-create-home \
    --shell /usr/sbin/nologin --comment "SmartDining - lectura de respaldos por SFTP" respaldos
fi

# --- 2. Carpetas ---------------------------------------------------------------
# ChrootDirectory exige que /srv/respaldos y todo lo de arriba sean de root y
# que nadie más pueda escribir en ellos.
paso "2. carpeta /srv/respaldos/$PROYECTO"
install -d -o root -g root -m 755 /srv/respaldos
install -d -o deploy -g sd-respaldos -m 2750 "/srv/respaldos/$PROYECTO"

# --- 3. SFTP de solo lectura ---------------------------------------------------
paso "3. SFTP de solo lectura para respaldos"
install -d -o root -g root -m 755 /etc/ssh/llaves-respaldos
ARCHIVO_LLAVE=/etc/ssh/llaves-respaldos/respaldos
if [ -n "$LLAVE" ]; then
  printf '%s\n' "$LLAVE" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^ ]+)?$' \
    || fallar "la llave debe ser UNA línea ssh-ed25519 (tipo, llave y comentario opcional)"
  printf '%s\n' "$LLAVE" | ssh-keygen -lf - >/dev/null 2>&1 || fallar "ssh-keygen no reconoce la llave"
  printf 'restrict %s\n' "$LLAVE" > "$ARCHIVO_LLAVE.nueva"
  chmod 644 "$ARCHIVO_LLAVE.nueva"
  mv "$ARCHIVO_LLAVE.nueva" "$ARCHIVO_LLAVE"
  echo "    llave de lectura: $(ssh-keygen -lf "$ARCHIVO_LLAVE")"
elif [ ! -s "$ARCHIVO_LLAVE" ]; then
  echo "    (sin llave todavía: respaldos no puede entrar; vuelve a correrlo con --llave-lectura)"
fi

SSHD_CONF=/etc/ssh/sshd_config.d/10-respaldos.conf
CONF_BASE=/etc/ssh/sshd_config.d/00-smartdining.conf
[ -f "$CONF_BASE" ] || fallar "no existe $CONF_BASE (corre antes preparar-servidor.sh)"
[ "$(grep -c '^AllowUsers ' "$CONF_BASE")" -eq 1 ] || fallar "$CONF_BASE debe tener exactamente una línea AllowUsers"
ANTERIOR=
if [ -f "$SSHD_CONF" ]; then ANTERIOR=$(mktemp); cp -p "$SSHD_CONF" "$ANTERIOR"; fi
ANTERIOR_BASE=$(mktemp)
cp -p "$CONF_BASE" "$ANTERIOR_BASE"

# respaldos va en la MISMA línea AllowUsers de 00-smartdining.conf
# (preparar-servidor.sh también lo conserva si el usuario existe).
if ! grep -Eq '^AllowUsers (.* )?respaldos( |$)' "$CONF_BASE"; then
  sed -i 's/^AllowUsers .*/& respaldos/' "$CONF_BASE"
  echo "    AllowUsers de $CONF_BASE: + respaldos"
fi

cat > "$SSHD_CONF.nuevo" <<'EOF'
# SmartDining (infra/scripts/instalar-respaldos.sh, R-18)
# respaldos: solo SFTP de lectura dentro de /srv/respaldos. Está en el
# AllowUsers de 00-smartdining.conf.
Match User respaldos
    ChrootDirectory /srv/respaldos
    ForceCommand internal-sftp -R
    AuthorizedKeysFile /etc/ssh/llaves-respaldos/%u
    PasswordAuthentication no
    AllowTcpForwarding no
    AllowAgentForwarding no
    AllowStreamLocalForwarding no
    PermitTunnel no
    PermitTTY no
    X11Forwarding no
# Cierra el Match: lo que sigue vuelve a aplicar a todos los usuarios.
Match all
EOF
chmod 644 "$SSHD_CONF.nuevo"
mv "$SSHD_CONF.nuevo" "$SSHD_CONF"

deshacer_sshd() {
  if [ -n "$ANTERIOR" ]; then mv "$ANTERIOR" "$SSHD_CONF"; else rm -f "$SSHD_CONF"; fi
  mv "$ANTERIOR_BASE" "$CONF_BASE"
  fallar "$1 Se dejó la configuración de SSH como estaba."
}
permite() {
  sshd -T -C "user=$1,host=localhost,addr=127.0.0.1" 2>/dev/null | grep -qx "allowusers $1"
}
sshd -t || deshacer_sshd "sshd -t rechazó la configuración."
for u in roberto deploy respaldos; do
  permite "$u" || deshacer_sshd "con la configuración nueva '$u' no podría entrar por SSH."
done
sshd -T -C "user=respaldos,host=localhost,addr=127.0.0.1" | grep -qx 'forcecommand internal-sftp -R' \
  || deshacer_sshd "respaldos no quedó limitado a internal-sftp -R."
for u in roberto deploy; do
  efectiva=$(sshd -T -C "user=$u,host=localhost,addr=127.0.0.1")
  printf '%s\n' "$efectiva" | grep -qx 'chrootdirectory none' \
    || deshacer_sshd "el Match de respaldos se extiende a '$u' (chroot)."
  if printf '%s\n' "$efectiva" | grep '^forcecommand ' | grep -vqx 'forcecommand none'; then
    deshacer_sshd "el Match de respaldos se extiende a '$u' (forcecommand)."
  fi
done
[ -z "$ANTERIOR" ] || rm -f "$ANTERIOR"
rm -f "$ANTERIOR_BASE"
# En Ubuntu 24.04 sshd puede estar activado por ssh.socket; reload sirve en ambos casos.
systemctl reload ssh 2>/dev/null || systemctl restart ssh

# --- 4. Variables privadas ----------------------------------------------------
# Va ANTES del timer: así el primer respaldo ya tiene su HEALTHCHECKS_URL.
paso "4. $ENV_PRIVADO"
install -d -o root -g root -m 700 /etc/smartdining
if [ ! -f "$ENV_PRIVADO" ]; then
  if [ "$ENTORNO" = staging ] && [ -f "$ENV_VIEJO" ]; then
    # Compatibilidad: el check de staging sigue siendo el mismo.
    cp -p "$ENV_VIEJO" "$ENV_PRIVADO"
    echo "    copiado de $ENV_VIEJO (el viejo se queda; se puede borrar a mano)"
  else
    ( umask 077
      printf '%s\n' \
        "# SmartDining · variables del respaldo diario de $ENTORNO (R-18). 600 root. NUNCA en el repo." \
        '# URL de ping de healthchecks.io, un check por entorno (docs/despliegue.md §4):' \
        '# HEALTHCHECKS_URL=https://hc-ping.com/<uuid>' > "$ENV_PRIVADO" )
  fi
fi
chown root:root "$ENV_PRIVADO"
chmod 600 "$ENV_PRIVADO"
if grep -q '^HEALTHCHECKS_URL=' "$ENV_PRIVADO"; then
  echo "    HEALTHCHECKS_URL: definida"
else
  echo "    HEALTHCHECKS_URL: sin definir (el timer respalda igual, pero nadie avisa si falla)"
fi

# --- 5. Script y timer ---------------------------------------------------------
paso "5. respaldo.sh y timer $UNIDAD"
if [ -f "$TIMER_VIEJO" ]; then
  # Solo llega aquí con ENTORNO=staging (comprobado arriba).
  systemctl disable --now smartdining-respaldo.timer >/dev/null 2>&1 || true
  rm -f "$TIMER_VIEJO" "$SERVICIO_VIEJO"
  echo "    timer viejo smartdining-respaldo.timer: desactivado y reemplazado por $UNIDAD.timer (los respaldos no se tocan)"
fi
install -d -o root -g root -m 755 /usr/local/lib/smartdining
install -o root -g root -m 755 infra/scripts/respaldo.sh /usr/local/lib/smartdining/respaldo.sh
install -o root -g root -m 644 'infra/systemd/smartdining-respaldo@.service' '/etc/systemd/system/smartdining-respaldo@.service'
install -o root -g root -m 644 'infra/systemd/smartdining-respaldo@.timer' '/etc/systemd/system/smartdining-respaldo@.timer'
systemctl daemon-reload
systemctl enable --now "$UNIDAD.timer" >/dev/null 2>&1

echo
systemctl list-timers 'smartdining-respaldo@*' --no-pager | head -3
echo "Listo. Prueba: sudo systemctl start $UNIDAD.service && journalctl -u $UNIDAD -n 20 --no-pager"
echo "Solo el entorno que está corriendo debe tener su timer activo; el otro: sudo systemctl disable --now smartdining-respaldo@<otro>.timer"
