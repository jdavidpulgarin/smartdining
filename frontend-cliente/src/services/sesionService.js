import { pedirJson } from './api';

export async function crearSesion(tokenQr, comensal) {
  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    const { crearSesionSimulada } = await import('./sesionSimulada');
    return crearSesionSimulada(tokenQr, comensal);
  }

  return pedirJson(`/mesas/qr/${encodeURIComponent(tokenQr)}/sesion`, {
    method: 'POST',
    body: { comensal },
  });
}

export default {
  crearSesion,
};
