#!/bin/sh
# Inicializa la base de SmartDining dentro del contenedor postgres:16-alpine.
#
# La imagen ejecuta los archivos de /docker-entrypoint-initdb.d solo la PRIMERA
# vez (con el volumen de datos vacío). Para volver a cargar todo desde cero:
#   docker compose down -v && docker compose up -d
#
# No se duplica el orden de los scripts: se usa migrar.sh (P-17), que con la
# base vacía corre 00_ejecutar_todo.sql (la línea base: schema.sql, 01 a 25 y
# seed.sql) y después los scripts nuevos (26 en adelante), registrándolos en
# schema_migraciones. Es el mismo camino que una base que ya tiene datos, así
# que una base nueva y una migrada quedan iguales.
#
# Si un script falla, migrar.sh termina con error y la inicialización falla en
# voz alta en vez de dejar una base a medio crear que parece sana.
set -eu

sh /smartdining-db/migrar.sh
