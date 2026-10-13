#!/usr/bin/env bash
# Corre `npm test` y falla si node --test reporta pruebas CANCELADAS.
#
# node --test no trata una prueba cancelada como fallida: si una prueba deja
# el event loop colgado, el runner cancela las que siguen en ese archivo y el
# proceso puede terminar con código 0 aunque no se haya probado nada. Por eso
# se lee el resumen. Se aceptan los dos formatos del resumen:
#   "# cancelled N" (reporter tap, el de Node 22 fuera de una terminal) y
#   "ℹ cancelled N" (reporter spec).
set -euo pipefail

salida="$(mktemp)"
trap 'rm -f "$salida"' EXIT

npm test 2>&1 | tee "$salida"

if ! grep -Eq '^(# |ℹ )cancelled [0-9]+' "$salida"; then
  echo "::error::No se encontró el resumen de node --test (¿se interrumpió el runner?)"
  exit 1
fi

if grep -Eq '^(# |ℹ )cancelled [1-9][0-9]*' "$salida"; then
  canceladas="$(grep -Eo '^(# |ℹ )cancelled [0-9]+' "$salida" | grep -Eo '[0-9]+$')"
  echo "::error::node --test reportó ${canceladas} prueba(s) cancelada(s). Una prueba cancelada no se ejecutó: revisa promesas o servidores que queden abiertos."
  exit 1
fi
