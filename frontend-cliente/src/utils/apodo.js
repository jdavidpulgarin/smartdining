const STORAGE_KEY = 'smartdining_apodo';

export function obtenerApodo() {
  try {
    const guardado = localStorage.getItem(STORAGE_KEY);
    return guardado ? guardado.trim() : '';
  } catch {
    return '';
  }
}

export function guardarApodo(nombre) {
  try {
    const limpio = (nombre ?? '').trim().slice(0, 40);
    if (limpio) {
      localStorage.setItem(STORAGE_KEY, limpio);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    return limpio;
  } catch {
    return '';
  }
}
