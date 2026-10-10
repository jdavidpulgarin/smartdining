import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { mesa as mesaMock } from '../mocks/mesa';

const STORAGE_KEY = 'smartdining_mesa_session';

export function useMesaSession() {
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState({
    mesa: null,
    token: null,
    valida: false,
    cargando: true,
  });

  useEffect(() => {
    const mesaParam = searchParams.get('mesa');
    const tokenParam = searchParams.get('token');

    const timer = setTimeout(() => {
      // 1. Si vienen parámetros en la URL, validamos contra los datos mock
      if (mesaParam && tokenParam) {
        const esMesaValida = Number(mesaParam) === mesaMock.numero;
        const esTokenValido = tokenParam === mesaMock.tokenQR;

        if (esMesaValida && esTokenValido) {
          const nuevaSesion = {
            mesa: Number(mesaParam),
            token: tokenParam,
            timestamp: Date.now(),
          };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(nuevaSesion));
          } catch {
            // localStorage no disponible o lleno
          }
          setSession({
            mesa: Number(mesaParam),
            token: tokenParam,
            valida: true,
            cargando: false,
          });
          return;
        } else {
          // Parámetros explícitos pero incorrectos
          setSession({
            mesa: null,
            token: null,
            valida: false,
            cargando: false,
          });
          return;
        }
      }

      // 2. Si no hay parámetros en la URL, buscamos sesión previa en localStorage
      try {
        const sesionGuardada = localStorage.getItem(STORAGE_KEY);
        if (sesionGuardada) {
          const parsed = JSON.parse(sesionGuardada);
          if (
            parsed &&
            Number(parsed.mesa) === mesaMock.numero &&
            parsed.token === mesaMock.tokenQR
          ) {
            setSession({
              mesa: Number(parsed.mesa),
              token: parsed.token,
              valida: true,
              cargando: false,
            });
            return;
          }
        }
      } catch {
        // Error al leer o parsear localStorage
      }

      // 3. Ni parámetros válidos ni sesión previa en localStorage
      setSession({
        mesa: null,
        token: null,
        valida: false,
        cargando: false,
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [searchParams]);

  return session;
}

export default useMesaSession;
