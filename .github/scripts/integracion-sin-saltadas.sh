#!/usr/bin/env bash
# Corre `npm run test:integracion` (backend, contra PostgreSQL real) y falla si
# el resumen de node --test trae pruebas FALLIDAS, CANCELADAS o SALTADAS.
#
# La idea es la de npm-test-sin-canceladas.sh, con una condición más: las
# suites de integración se SALTAN solas cuando no encuentran base (sin PG*), y
# node --test cuenta una prueba saltada como éxito. En el CI eso significaría
# "verde sin haber probado nada contra la base", así que skipped > 0 es un
# fallo. También falla si no aparece el resumen (el runner se interrumpió) o si
# no corrió ninguna prueba.
#
# La salida COMPLETA de las pruebas va al log (tee), no solo el resumen: si una
# prueba falla, el mensaje de error exacto queda en el log del job.
#
# Formatos del resumen aceptados: "# pass N" (reporter tap, el de Node 22 fuera
# de una terminal) y "ℹ pass N" (reporter spec).
#
# Uso:
#   bash integracion-sin-saltadas.sh            corre las pruebas (en backend/)
#   bash integracion-sin-saltadas.sh salida.txt solo revisa una salida ya
#                                               guardada (para probar el script)
set -euo pipefail

salida="$(mktemp)"
trap 'rm -f "$salida"' EXIT

codigo=0
if [ "$#" -ge 1 ]; then
  cat "$1" > "$salida"
else
  # `|| codigo=$?`: con pipefail, un npm que termina con error no corta el
  # script aquí; primero se lee el resumen para dar un mensaje claro.
  npm run test:integracion 2>&1 | tee "$salida" || codigo=$?
fi

# Último valor de un contador del resumen ("" si no aparece).
contador() {
  grep -Eo "^(# |ℹ )$1 [0-9]+" "$salida" | tail -n 1 | grep -Eo '[0-9]+$' || true
}

tests="$(contador tests)"
pass="$(contador pass)"
fail="$(contador fail)"
cancelled="$(contador cancelled)"
skipped="$(contador skipped)"

if [ -z "$tests" ] || [ -z "$pass" ] || [ -z "$fail" ] || [ -z "$cancelled" ] || [ -z "$skipped" ]; then
  echo "::error::No se encontró el resumen completo de node --test (tests, pass, fail, cancelled, skipped). ¿Se interrumpió el runner?"
  exit 1
fi

echo "Resumen de integración: tests=${tests} pass=${pass} fail=${fail} cancelled=${cancelled} skipped=${skipped}"

error=0
if [ "$tests" -eq 0 ]; then
  echo "::error::No corrió ninguna prueba de integración."
  error=1
fi
if [ "$fail" -gt 0 ]; then
  echo "::error::${fail} prueba(s) de integración fallaron. El error completo está más arriba en el log."
  error=1
fi
if [ "$cancelled" -gt 0 ]; then
  echo "::error::${cancelled} prueba(s) cancelada(s): no se ejecutaron. Revisa promesas o conexiones que queden abiertas."
  error=1
fi
if [ "$skipped" -gt 0 ]; then
  echo "::error::${skipped} prueba(s) saltada(s): no probaron contra la base. Revisa PGHOST/PGDATABASE y que la base esté migrada."
  error=1
fi
if [ "$error" -ne 0 ]; then
  exit 1
fi

if [ "$codigo" -ne 0 ]; then
  echo "::error::npm run test:integracion terminó con código ${codigo} aunque el resumen está limpio."
  exit "$codigo"
fi
