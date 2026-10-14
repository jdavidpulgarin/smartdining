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
  pkill -f "smartdining.*4000" || true
  pkill -f "smartdining.*4001" || true
  echo "Entorno apagado y limpio."
  exit 0
fi

echo "====================================================="
echo "  SmartDining: Levantando Entorno Real de Pruebas   "
echo "====================================================="

# 1. Levantar PostgreSQL con Docker
if command -v docker >/dev/null 2>&1; then
  echo "===> Levantando PostgreSQL 16 con Docker..."
  docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" up -d
  echo "Esperando a que la base esté lista..."
  until docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" exec -T postgres-test pg_isready -U postgres -d smartdining_test; do
    sleep 1
  done
  echo "PostgreSQL 16 listo en puerto 5433."
else
  echo "Docker no detectado. Usando PostgreSQL local en puerto 5432..."
fi

# 2. Inicializar base smartdining_test desde scripts maestros si es necesario
echo "===> Verificando esquema en smartdining_test..."
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-smartdining_test}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if command -v psql >/dev/null 2>&1; then
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -tc "SELECT 1 FROM pg_database WHERE datname = 'smartdining_test'" | grep -q 1 || \
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c "CREATE DATABASE smartdining_test;"
  
  (cd "$REPO_ROOT/database/scripts" && psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d smartdining_test -v ON_ERROR_STOP=1 -f 00_ejecutar_todo.sql)
fi

echo "===> Entorno de base de datos listo para pruebas."
