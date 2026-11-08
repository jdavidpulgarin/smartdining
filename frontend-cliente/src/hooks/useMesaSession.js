import { useSesion } from '../context/SesionContext';
import { aliasDelToken } from '../services/clienteMesa';

export function useMesaSession() {
  const contexto = useSesion();
  const sesion = contexto.sesion;
  const aliasJwt = sesion?.token ? aliasDelToken(sesion.token) : null;

  return {
    ...contexto,
    mesa: sesion?.numeroMesa ?? null,
    idMesa: sesion?.idMesa ?? null,
    comensal: aliasJwt || sesion?.comensal || '',
    token: sesion?.token ?? null,
    valida: contexto.estado === 'activa',
    cargando: contexto.estado === 'cargando',
  };
}

export default useMesaSession;
