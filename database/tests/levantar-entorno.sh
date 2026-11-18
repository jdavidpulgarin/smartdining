#!/usr/bin/env bash
# ==============================================================================
# SmartDining: Script de arranque del entorno real de pruebas
# Base de datos: smartdining_test
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

accion="${1:-up}"

if [ "$accion" = "down" ]; then
  echo "===> Apagando entorno de pruebas..."
  if command -v docker >/dev/null 2>&1; then
    docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" down -v || true
  fi
  # Matar procesos locales si existen
  pkill -f "smartdining.*4000" 2>/dev/null || true
  pkill -f "smartdining.*4001" 2>/dev/null || true
  echo "Entorno apagado y limpio."
  exit 0
fi

echo "====================================================="
echo "  SmartDining: Levantando Entorno Real de Pruebas   "
echo "====================================================="

# 1. Levantar PostgreSQL con Docker
# Con Docker, docker-init.sh ya carga el esquema y el seed al crear el volumen
# (y escucha en 5433); sin Docker se usa un PostgreSQL local en 5432 y se carga
# aquí. Las credenciales "postgres" son solo de esta base de pruebas local.
CON_DOCKER=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  CON_DOCKER=1
  echo "===> Levantando PostgreSQL 16 con Docker..."
  docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" up -d
  echo "Esperando a que la base esté lista..."
  # Por TCP (-h 127.0.0.1): durante la primera inicialización el servidor
  # temporal solo escucha en el socket, así que no responde hasta que
  # docker-init.sh -> migrar.sh termina y arranca el servidor definitivo.
  until docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" exec -T postgres-test pg_isready -h 127.0.0.1 -U postgres -d smartdining_test; do
    sleep 1
  done
  echo "PostgreSQL 16 listo en puerto 5433."
else
  echo "Docker no disponible. Usando PostgreSQL local en puerto 5432..."
fi

# 2. Inicializar base smartdining_test (solo sin Docker)
PGHOST="${PGHOST:-localhost}"
if [ "$CON_DOCKER" = "1" ]; then
  PGPORT="${PGPORT:-5433}"
else
  PGPORT="${PGPORT:-5432}"
fi
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-smartdining_test}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [ "$CON_DOCKER" = "0" ] && command -v psql >/dev/null 2>&1; then
  if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'smartdining_test'" | grep -q 1; then
    echo "===> Creando smartdining_test..."
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "CREATE DATABASE smartdining_test;"
  fi
  # migrar.sh (P-17), el mismo camino que Docker y producción: con la base
  # vacía carga la línea base y los scripts nuevos (26 en adelante); con una
  # base ya cargada aplica solo lo que falte.
  echo "===> Migrando smartdining_test con migrar.sh..."
  PGHOST="$PGHOST" PGPORT="$PGPORT" PGUSER="$PGUSER" PGDATABASE="$PGDATABASE" \
    sh "$REPO_ROOT/database/migrar.sh"
fi

echo "===> Entorno de base de datos listo para pruebas."
