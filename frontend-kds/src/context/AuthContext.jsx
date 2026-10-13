import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { EVENTO_NO_AUTORIZADO, login as loginApi } from '../services/api'

/**
 * Sesion del usuario de cocina.
 *
 * El JWT se guarda en sessionStorage y no en localStorage: la pantalla de
 * cocina es un equipo compartido, y al cerrar el navegador la sesion no deberia
 * seguir abierta para el siguiente turno. Todo acceso al storage va en
 * try/catch porque en modo privado o con el almacenamiento bloqueado lanza, y
 * el KDS tiene que funcionar igual (solo se pierde recordar la sesion).
 */

const CLAVE_SESION = 'kds_sesion'

/** Roles que pueden ver la cocina, los mismos que acepta GET /api/kds/comandas. */
export const ROLES_PERMITIDOS = ['cocina', 'admin']

export const MENSAJE_ROL_NO_PERMITIDO = 'Este usuario no tiene acceso a la cocina'
export const MENSAJE_SESION_CAIDA = 'Tu sesión expiró, vuelve a entrar'

const AuthContext = createContext(null)

function leerSesion() {
  try {
    const guardado = sessionStorage.getItem(CLAVE_SESION)
    if (!guardado) return null
    const sesion = JSON.parse(guardado)
    if (!sesion?.token || !ROLES_PERMITIDOS.includes(sesion?.usuario?.rol)) return null
    return sesion
  } catch {
    // Storage no disponible o con basura: se empieza sin sesion.
    return null
  }
}

function guardarSesion(sesion) {
  try {
    sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion))
  } catch {
    // Sin storage la sesion vive solo en memoria: se pierde al recargar, pero
    // la app funciona.
  }
}

function borrarSesion() {
  try {
    sessionStorage.removeItem(CLAVE_SESION)
  } catch {
    // Nada que limpiar si el storage no esta disponible.
  }
}

export function AuthProvider({ children }) {
  const [sesion, setSesion] = useState(leerSesion)
  const [aviso, setAviso] = useState(null)

  const cerrarSesion = useCallback((mensaje = null) => {
    borrarSesion()
    setSesion(null)
    setAviso(mensaje)
  }, [])

  /**
   * Cualquier 401 de la API cierra la sesion, venga de donde venga: el
   * servicio dispara un evento y aqui se escucha una sola vez, en vez de que
   * cada pantalla tenga que acordarse.
   */
  useEffect(() => {
    const alCaducar = () => cerrarSesion(MENSAJE_SESION_CAIDA)
    window.addEventListener(EVENTO_NO_AUTORIZADO, alCaducar)
    return () => window.removeEventListener(EVENTO_NO_AUTORIZADO, alCaducar)
  }, [cerrarSesion])

  /**
   * Entra con email y contrasena. El rol se comprueba aqui y no solo en el
   * backend para dar un mensaje claro: un mesero con credenciales validas
   * recibiria 403 al pedir las comandas y no sabria por que.
   */
  const entrar = useCallback(async (email, password) => {
    const datos = await loginApi(email, password)

    if (!ROLES_PERMITIDOS.includes(datos?.usuario?.rol)) {
      throw new Error(MENSAJE_ROL_NO_PERMITIDO)
    }

    const nueva = { token: datos.token, usuario: datos.usuario }
    guardarSesion(nueva)
    setSesion(nueva)
    setAviso(null)
    return nueva
  }, [])

  const valor = useMemo(
    () => ({
      sesion,
      usuario: sesion?.usuario || null,
      token: sesion?.token || null,
      autenticado: Boolean(sesion?.token),
      aviso,
      entrar,
      cerrarSesion,
      limpiarAviso: () => setAviso(null),
    }),
    [sesion, aviso, entrar, cerrarSesion]
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const contexto = useContext(AuthContext)
  if (!contexto) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return contexto
}
