import { useSesion } from '../context/SesionContext';

export function useMesaSession() {
  const contexto = useSesion();
  const sesion = contexto.sesion;

  return {
    ...contexto,
    mesa: sesion?.numeroMesa ?? null,
    idMesa: sesion?.idMesa ?? null,
    comensal: sesion?.comensal ?? '',
    token: sesion?.token ?? null,
    valida: contexto.estado === 'activa',
    cargando: contexto.estado === 'cargando',
  };
}

export default useMesaSession;
