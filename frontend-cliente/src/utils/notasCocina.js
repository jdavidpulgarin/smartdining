export const NOTAS_MAX_SERVIDOR = 200;

export function construirNotasCocina(plato, selecciones = {}, notasCliente = '') {
  const partes = [];
  const personalizaciones = plato?.personalizaciones ?? [];

  for (const grupo of personalizaciones) {
    const seleccionados = selecciones?.[grupo.id];
    if (!seleccionados) continue;

    const idsSeleccionados = Array.isArray(seleccionados)
      ? seleccionados
      : [seleccionados];

    for (const opcion of grupo.opciones ?? []) {
      if (idsSeleccionados.includes(opcion.id)) {
        if (opcion.nombre) {
          partes.push(opcion.nombre.trim());
        }
      }
    }
  }

  const notasLimpias = typeof notasCliente === 'string' ? notasCliente.trim() : '';
  if (notasLimpias.length > 0) {
    partes.push(notasLimpias);
  }

  return partes.join(', ');
}
