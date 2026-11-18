/**
 * El rol cocina trabaja en la pantalla de cocina (frontend-kds), no en el panel.
 * El backend ya le niega casi todo lo del panel (403 en pedidos, caja,
 * reportes...), así que en el panel solo vería errores: se le avisa y se le
 * lleva al KDS.
 */
export const ROL_COCINA = 'cocina'

export function esCocina(rol) {
  return rol === ROL_COCINA
}

/**
 * URL de la pantalla de cocina, en este orden:
 *   1. VITE_KDS_URL, si el build la trae;
 *   2. en un despliegue, el mismo dominio con `cocina.` en lugar de `staff.`
 *      (infra/nginx: staff.<dominio> es el panel y cocina.<dominio> el KDS);
 *   3. en desarrollo y en la demo por la red local, el mismo host en el
 *      puerto 5175 (el del KDS en vite).
 */
export function urlDelKds(ubicacion = globalThis.location, env = import.meta.env) {
  const configurada = env && typeof env.VITE_KDS_URL === 'string' ? env.VITE_KDS_URL.trim() : ''
  if (configurada) return configurada
  const protocolo = ubicacion?.protocol || 'http:'
  const host = ubicacion?.hostname || 'localhost'
  if (host.startsWith('staff.')) return `${protocolo}//cocina.${host.slice('staff.'.length)}/`
  return `${protocolo}//${host}:5175/`
}
