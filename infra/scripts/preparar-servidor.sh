#!/usr/bin/env bash
# Prepara un VPS Ubuntu 24.04 NUEVO antes de instalar SmartDining (R-17.1).
# Es idempotente: correrlo dos veces deja el mismo resultado.
#
#   sudo bash infra/scripts/preparar-servidor.sh "ssh-ed25519 AAAA... comentario"
#   sudo bash infra/scripts/preparar-servidor.sh ~/.ssh/id_ed25519.pub roberto
#
# Argumentos:
#   1. Llave PÚBLICA del administrador (la línea completa, o la ruta a un .pub).
#   2. Usuario administrador (opcional, por defecto "roberto").
# Variables opcionales: ZONA_HORARIA (America/Bogota), NOMBRE_HOST (smartdining).
#
# Qué hace, en orden:
#   1. Sistema base: actualiza, instala ufw/fail2ban/unattended-upgrades, zona
#      horaria, hostname, swap de 2 GB si no hay ninguna, vm.swappiness=10 y
#      actualizaciones automáticas SOLO de seguridad y SIN reinicio automático.
#   2. Usuarios: ADMIN (sudo sin contraseña, solo llave) y deploy (sin sudo;
#      su llave se agrega aparte, ver docs/despliegue.md).
#   3. SSH: sin root, sin contraseñas, AllowUsers ADMIN deploy.
#   4. Firewall (22, 80, 443) y fail2ban para sshd.
#   5. Docker Engine + compose desde el repositorio oficial, con rotación de logs.
#
# ANTI-BLOQUEO: cuando el paso 3 cambia la configuración de SSH, programa una
# reversión automática en 10 minutos. Prueba en una terminal NUEVA
#   ssh ADMIN@SERVIDOR "sudo -n true && echo sudo-ok"
# y solo si funciona cancela la reversión con:
#   sudo systemctl stop sd-revert-ssh.timer
# No cierres la sesión actual hasta haberlo comprobado.
#
# No reinicia el servidor. Si hace falta, lo avisa al final.
set -euo pipefail

# ---------------------------------------------------------------- argumentos
[ "$(id -u)" -eq 0 ] || { echo "Córrelo con sudo o como root." >&2; exit 1; }
[ $# -ge 1 ] || { sed -n '2,12p' "$0" >&2; exit 1; }

LLAVE_ARG=$1
ADMIN=${2:-roberto}
ZONA_HORARIA=${ZONA_HORARIA:-America/Bogota}
NOMBRE_HOST=${NOMBRE_HOST:-smartdining}
DEPLOY=deploy

if [ -f "$LLAVE_ARG" ]; then LLAVE=$(head -n 1 "$LLAVE_ARG"); else LLAVE=$LLAVE_ARG; fi
case "$LLAVE" in
  *PRIVATE\ KEY*) echo "Eso es una llave PRIVADA. Pasa la .pub." >&2; exit 1 ;;
esac
TMP_LLAVE=$(mktemp)
trap 'rm -f "$TMP_LLAVE"' EXIT
printf '%s\n' "$LLAVE" > "$TMP_LLAVE"
ssh-keygen -lf "$TMP_LLAVE" >/dev/null 2>&1 || { echo "La llave pública no es válida." >&2; exit 1; }
[[ "$ADMIN" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "Usuario inválido: $ADMIN" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
APT_OPTS=(-y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

paso() { printf '\n==> %s\n' "$*"; }

# Escribe $1 con el contenido de stdin solo si cambia. Devuelve 0 si lo cambió.
escribir_si_cambia() {
  local destino=$1 nuevo
  nuevo=$(mktemp)
  cat > "$nuevo"
  if [ -f "$destino" ] && cmp -s "$nuevo" "$destino"; then
    rm -f "$nuevo"; return 1
  fi
  install -m "${2:-644}" "$nuevo" "$destino"
  rm -f "$nuevo"
}

# ------------------------------------------------------- 1. sistema base
paso "1. Sistema base"
apt-get update -q
apt-get "${APT_OPTS[@]}" upgrade
apt-get "${APT_OPTS[@]}" install ufw fail2ban unattended-upgrades ca-certificates curl gnupg python3-systemd

timedatectl set-timezone "$ZONA_HORARIA"
hostnamectl set-hostname "$NOMBRE_HOST"

if [ -z "$(swapon --show --noheadings)" ] && [ ! -e /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
fi
if [ -e /swapfile ] && ! grep -qE '^\s*/swapfile\s' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
if escribir_si_cambia /etc/sysctl.d/99-smartdining.conf <<'EOF'
vm.swappiness=10
EOF
then sysctl -q -p /etc/sysctl.d/99-smartdining.conf; fi

escribir_si_cambia /etc/apt/apt.conf.d/20auto-upgrades <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
escribir_si_cambia /etc/apt/apt.conf.d/52smartdining-unattended <<'EOF' || true
// SmartDining: solo parches de seguridad y NUNCA reiniciar automáticamente.
#clear "Unattended-Upgrade::Allowed-Origins";
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

# ------------------------------------------------------- 2. usuarios
paso "2. Usuarios: $ADMIN (sudo) y $DEPLOY (sin sudo)"
for u in "$ADMIN" "$DEPLOY"; do
  id "$u" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$u" >/dev/null
  install -d -m 700 -o "$u" -g "$u" "/home/$u/.ssh"
  [ -f "/home/$u/.ssh/authorized_keys" ] || install -m 600 -o "$u" -g "$u" /dev/null "/home/$u/.ssh/authorized_keys"
done
usermod -aG sudo "$ADMIN"
gpasswd -d "$DEPLOY" sudo >/dev/null 2>&1 || true

if escribir_si_cambia "/etc/sudoers.d/90-$ADMIN" 440 <<EOF
$ADMIN ALL=(ALL) NOPASSWD:ALL
EOF
then
  visudo -cqf "/etc/sudoers.d/90-$ADMIN" || { rm -f "/etc/sudoers.d/90-$ADMIN"; echo "sudoers inválido" >&2; exit 1; }
fi

AK="/home/$ADMIN/.ssh/authorized_keys"
grep -qxF "$LLAVE" "$AK" || printf '%s\n' "$LLAVE" >> "$AK"
chown "$ADMIN:$ADMIN" "$AK"; chmod 600 "$AK"

# ------------------------------------------------------- 3. SSH
paso "3. SSH endurecido"
# Prefijo 00: sshd usa el PRIMER valor que lee, así que este archivo gana sobre
# 50-cloud-init.conf / 50-cloudimg-settings.conf (que traen PasswordAuthentication yes).
SSHD_CONF=/etc/ssh/sshd_config.d/00-smartdining.conf
if escribir_si_cambia "$SSHD_CONF" <<EOF
# SmartDining (infra/scripts/preparar-servidor.sh)
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
AllowUsers $ADMIN $DEPLOY
EOF
then
  if ! sshd -t; then
    rm -f "$SSHD_CONF"; echo "Configuración de sshd inválida; revertida." >&2; exit 1
  fi
  systemctl stop sd-revert-ssh.timer >/dev/null 2>&1 || true
  systemctl reset-failed sd-revert-ssh.service sd-revert-ssh.timer >/dev/null 2>&1 || true
  systemd-run --quiet --unit=sd-revert-ssh --on-active=10min \
    /bin/sh -c "rm -f $SSHD_CONF; systemctl reload ssh || systemctl restart ssh"
  # En Ubuntu 24.04 sshd puede estar activado por ssh.socket; reload sirve en ambos casos.
  systemctl reload ssh 2>/dev/null || systemctl restart ssh
  REVERSION_ARMADA=1
fi
sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|allowusers) '

# ------------------------------------------------------- 4. firewall y fail2ban
paso "4. UFW y fail2ban"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status verbose

if escribir_si_cambia /etc/fail2ban/jail.d/smartdining.local <<'EOF'
[sshd]
enabled  = true
backend  = systemd
bantime  = 1h
findtime = 10m
maxretry = 5
EOF
then systemctl restart fail2ban; fi
systemctl enable --now fail2ban >/dev/null 2>&1
for _ in 1 2 3 4 5; do fail2ban-client ping >/dev/null 2>&1 && break; sleep 2; done
fail2ban-client status sshd

# ------------------------------------------------------- 5. Docker
paso "5. Docker Engine (repositorio oficial)"
for p in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  if dpkg -s "$p" >/dev/null 2>&1; then apt-get "${APT_OPTS[@]}" remove "$p"; fi
done
install -m 0755 -d /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
fi
chmod a+r /etc/apt/keyrings/docker.asc
# shellcheck disable=SC1091
. /etc/os-release
escribir_si_cambia /etc/apt/sources.list.d/docker.sources <<EOF || true
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -q
apt-get "${APT_OPTS[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

install -d -m 755 /etc/docker
DOCKER_CAMBIO=0
escribir_si_cambia /etc/docker/daemon.json <<'EOF' && DOCKER_CAMBIO=1
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
usermod -aG docker "$ADMIN"
usermod -aG docker "$DEPLOY"
systemctl enable docker containerd >/dev/null 2>&1
if [ "$DOCKER_CAMBIO" -eq 1 ]; then systemctl restart docker; else systemctl start docker; fi
docker version --format 'Docker {{.Server.Version}}'
docker compose version

# ------------------------------------------------------- resumen
paso "Listo"
if [ -f /var/run/reboot-required ]; then
  echo "AVISO: el sistema pide reinicio (/var/run/reboot-required). Hazlo cuando convenga; este script no reinicia."
else
  echo "No hace falta reiniciar."
fi
if [ "${REVERSION_ARMADA:-0}" -eq 1 ]; then
  cat <<EOF

IMPORTANTE: la configuración de SSH se revierte sola en 10 minutos.
  1. En una terminal NUEVA: ssh $ADMIN@<servidor> "sudo -n true && echo sudo-ok"
  2. Si funciona:           sudo systemctl stop sd-revert-ssh.timer
  3. Comprueba que root ya no entra: ssh root@<servidor>  (debe decir Permission denied)
EOF
fi
