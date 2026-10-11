#!/bin/sh
# Inicializa la base de SmartDining dentro del contenedor postgres:16-alpine.
#
# La imagen ejecuta los archivos de /docker-entrypoint-initdb.d solo la PRIMERA
# vez (con el volumen de datos vacío). Para volver a cargar todo desde cero:
#   docker compose down -v && docker compose up -d
#
# No se duplica el orden de los scripts: se usa el script maestro del equipo,
# 00_ejecutar_todo.sql (schema.sql y luego 01 a 14), que es la fuente de verdad
# del orden. Sus \i usan rutas relativas al directorio de trabajo (\i ../schema.sql),
# por eso se ejecuta desde scripts/.
#
# ON_ERROR_STOP: si un script falla, la inicialización falla en voz alta en vez
# de dejar una base a medio crear que parece sana.
set -eu

cd /smartdining-db/scripts
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --file 00_ejecutar_todo.sql
