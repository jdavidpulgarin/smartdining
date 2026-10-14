#!/bin/sh
# Contraseñas del personal en PRODUCCIÓN (en el VPS, desde la raíz del clon).
#
#   sh infra/scripts/passwords-demo.sh verificar        # sale con 1 si queda alguna conocida
#   sh infra/scripts/passwords-demo.sh cambiar          # pide la nueva y la aplica a esas cuentas
#   sh infra/scripts/passwords-demo.sh cambiar --todos  # la aplica a TODAS las cuentas
#
# "Conocida" = su hash está escrito en el repositorio (p. ej. Admin123! de
# backend/scripts/fijar-password-demo.sql) o es una contraseña de diccionario.
# primer-certificado.sh y el workflow Deploy llaman a `verificar` y NO publican
# el sitio (nginx) mientras falle.
#
# La lógica está en passwords-demo.cjs y corre dentro del contenedor backend
# (usa su pg y su bcrypt). Requiere el contenedor backend en marcha.
set -eu

cd "$(dirname "$0")/../.."
ENV_FILE=${ENV_FILE:-infra/.env}
MODO=${1:-}
TODOS=0
[ "${2:-}" = "--todos" ] && TODOS=1

dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }

# Todo hash bcrypt de los archivos versionados es público por definición.
hashes_publicos() {
  git grep -h -o -E '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}' | sort -u || true
}

ejecutar() {
  dc exec -T -e SD_PASSWORDS="$1" -e SD_TODOS="$TODOS" backend \
    node -e "$(cat infra/scripts/passwords-demo.cjs)"
}

case "$MODO" in
  verificar)
    hashes_publicos | ejecutar verificar
    ;;
  cambiar)
    [ -t 0 ] || { echo "cambiar es interactivo: córrelo en una terminal" >&2; exit 2; }
    # Si se interrumpe a mitad, la terminal no queda sin eco.
    trap 'stty echo' EXIT INT TERM
    stty -echo
    printf 'Contraseña nueva (12+ caracteres, no se muestra): '
    read -r CLAVE1
    printf '\nRepítela: '
    read -r CLAVE2
    stty echo
    printf '\n'
    [ "$CLAVE1" = "$CLAVE2" ] || { echo "No coinciden; no se cambió nada." >&2; exit 2; }
    # Por stdin: la contraseña no queda en argumentos ni en variables del contenedor.
    { printf '%s\n' "$CLAVE1"; hashes_publicos; } | ejecutar cambiar
    CLAVE1=; CLAVE2=
    hashes_publicos | ejecutar verificar
    ;;
  *)
    echo "Uso: sh infra/scripts/passwords-demo.sh verificar | cambiar [--todos]" >&2
    exit 2
    ;;
esac
