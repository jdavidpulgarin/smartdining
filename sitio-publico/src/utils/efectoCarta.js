import { obtenerMenuPublico } from '../services/menuService.js';
import { iniciarRefresco } from './refrescoCarta.js';
import { combinarMenu } from './combinarMenu.js';

export function efectoCarta({
  menuInicial,
  obtener = obtenerMenuPublico,
  setMenu,
  setError,
  setCargando,
  doc,
  intervaloMs = 15000,
} = {}) {
  let cancelado = false;

  async function cargarInicial() {
    try {
      const datos = await obtener();
      if (!cancelado) {
        setMenu?.(datos);
        setError?.(false);
      }
    } catch (err) {
      console.error('Error al cargar el menú público:', err);
      if (!cancelado) {
        setError?.(true);
      }
    } finally {
      if (!cancelado) {
        setCargando?.(false);
      }
    }
  }

  if (!menuInicial) {
    cargarInicial();
  }

  const detener = iniciarRefresco({
    cargar: async () => {
      try {
        const nuevo = await obtener();
        if (!cancelado) {
          setMenu?.((prev) => combinarMenu(prev, nuevo));
        }
      } catch {
        // Ignorar fallos en refresco en background
      }
    },
    intervaloMs,
    doc,
  });

  return () => {
    cancelado = true;
    detener();
  };
}

export default efectoCarta;
