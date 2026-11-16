/**
 * La tablet de la mesa («QR en vidrio») sin sesión del personal (regresión
 * v1.0.0, FALLO 1).
 *
 * Antes, «Lanzar Pantalla» abría /pantalla/mesa/<NÚMERO> en una pestaña nueva:
 *   - sin la sesión del personal (vive en sessionStorage y no pasa a otra
 *     pestaña ni a otra tablet): sin credencial, sin socket, «Esperando…»;
 *   - con el número en vez del id_mesa: con mesas de id ≠ número, la tablet
 *     escuchaba otra mesa;
 *   - y nada le daba el QR vigente de una mesa ya abierta (GET /api/mesas no
 *     trae token_qr; con gente, ROTAR QR responde 409).
 *
 * Ahora quien tiene sesión (la pestaña del panel, o un login de una sola vez en
 * la tablet) prepara la tablet:
 *   1. pide la credencial de PANTALLA (POST /qr/pantalla, socket-server);
 *   2. mira la mesa con el GET público (GET /api/mesas/:id): solo si está
 *      OCUPADA pide el QR vigente con POST /abrir, que con la mesa ya abierta
 *      devuelve el mismo token (reutilizado) sin cambiar nada. Con la mesa
 *      libre NUNCA llama a /abrir: eso la abriría;
 *   3. le pasa las dos cosas en el # de la URL (no viaja al servidor):
 *      /pantalla/mesa/<id_mesa>#t=<credencial>&qr=<url del QR>.
 *
 * La tablet guarda en localStorage solo la credencial de pantalla y el último
 * QR (que de todas formas se ve en la pantalla). Nunca la sesión del personal.
 */
import { tokenDeUrl } from './qrRotacion'

export const claveCredencialTablet = (idMesa) => `smartdining_pantalla_token_${idMesa}`
export const claveQrTablet = (idMesa) => `smartdining_pantalla_qr_${idMesa}`
export const claveTokenQrTablet = (idMesa) => `smartdining_pantalla_qrtoken_${idMesa}`

/** El enlace de la tablet: la ruta lleva el id_mesa; credencial y QR, en el #. */
export function armarEnlaceTablet({ origen = '', idMesa, credencial, qrUrl }) {
  const p = new URLSearchParams()
  if (credencial) p.set('t', credencial)
  if (qrUrl) p.set('qr', qrUrl)
  const fragmento = p.toString()
  return `${origen}/pantalla/mesa/${idMesa}${fragmento ? `#${fragmento}` : ''}`
}

/**
 * La url del QR con otro token. qr:actualizado trae solo token_qr (sin url):
 * sin esto, la tablet que guardó la url seguiría dibujando el token viejo.
 */
export function urlConToken(url, token) {
  if (!url || !token) return url || ''
  try {
    const u = new URL(url)
    u.searchParams.set('token', token)
    return u.toString()
  } catch {
    return url
  }
}

/** Lo que trae el # del enlace: { credencial, qrUrl, token } (null si no viene). */
export function leerFragmentoTablet(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''))
  const credencial = p.get('t') || null
  const qrUrl = p.get('qr') || null
  return { credencial, qrUrl, token: tokenDeUrl(qrUrl) }
}

const leer = (storage, clave) => {
  try {
    return storage?.getItem(clave) || null
  } catch {
    return null
  }
}
const escribir = (storage, clave, valor) => {
  try {
    if (valor) storage?.setItem(clave, valor)
    else storage?.removeItem(clave)
  } catch {
    // sin almacenamiento (modo privado): la tablet sigue con lo que tiene en memoria
  }
}

/** Lo guardado en la tablet para esa mesa: { credencial, qrUrl, token }. */
export function leerTablet(storage, idMesa) {
  const credencial = leer(storage, claveCredencialTablet(idMesa))
  const qrUrl = leer(storage, claveQrTablet(idMesa))
  return { credencial, qrUrl, token: tokenDeUrl(qrUrl) || leer(storage, claveTokenQrTablet(idMesa)) }
}

/**
 * Guarda lo que venga. `qrUrl: null` olvida el QR (mesa liberada: está
 * revocado); `undefined` no lo toca. `token`: el QR cuando no se conoce su url
 * (qr:actualizado trae solo el token). La credencial solo se reemplaza si viene.
 */
export function guardarTablet(storage, idMesa, { credencial, qrUrl, token } = {}) {
  if (credencial) escribir(storage, claveCredencialTablet(idMesa), credencial)
  if (qrUrl !== undefined) escribir(storage, claveQrTablet(idMesa), qrUrl)
  if (token !== undefined) escribir(storage, claveTokenQrTablet(idMesa), token)
  else if (qrUrl !== undefined) escribir(storage, claveTokenQrTablet(idMesa), null)
}

/** Credencial vencida o rechazada: se olvida (y el QR con ella). */
export function olvidarTablet(storage, idMesa) {
  escribir(storage, claveCredencialTablet(idMesa), null)
  escribir(storage, claveQrTablet(idMesa), null)
  escribir(storage, claveTokenQrTablet(idMesa), null)
}

/**
 * Al abrir la tablet: toma el # (si viene), lo guarda y devuelve lo que hay
 * para esa mesa. Quitar el # de la barra (history.replaceState) es de quien
 * llama, que sabe la ruta.
 * @returns {{ credencial: string|null, qrUrl: string|null, token: string|null, venia: boolean }}
 */
export function tomarFragmentoTablet(storage, idMesa, hash) {
  const f = leerFragmentoTablet(hash)
  const venia = Boolean(f.credencial || f.qrUrl)
  if (venia) guardarTablet(storage, idMesa, { credencial: f.credencial, qrUrl: f.qrUrl || undefined })
  return { ...leerTablet(storage, idMesa), venia }
}

/**
 * El QR vigente de una mesa, sin abrirla NUNCA:
 *   1. obtenerMesa(id) — el GET público, que dice el estado;
 *   2. solo si está 'ocupada', abrirMesa(id) — POST /abrir, que con la mesa
 *      abierta devuelve el mismo token (reutilizado).
 * Con otro estado devuelve qrUrl null y no llama a abrirMesa.
 *
 * @param {number} idMesa
 * @param {{ obtenerMesa: (id) => Promise<{estado, numero}>, abrirMesa: (id) => Promise<{token?, url?}> }} io
 */
export async function qrVigenteDeMesa(idMesa, { obtenerMesa, abrirMesa }) {
  const mesa = await obtenerMesa(idMesa)
  const estado = mesa?.estado ?? null
  const numero = mesa?.numero ?? null
  if (estado !== 'ocupada') return { estado, numero, qrUrl: null, token: null }
  const r = await abrirMesa(idMesa)
  const qrUrl = r?.url || null
  return { estado, numero, qrUrl, token: r?.token || tokenDeUrl(qrUrl) }
}

/**
 * Prepara la tablet de una mesa con una sesión del personal: credencial de
 * pantalla + QR vigente (si la mesa está ocupada) + el enlace con todo en el #.
 *
 * @param {number} idMesa
 * @param {{ pedirCredencial: (id) => Promise<{token}>, obtenerMesa, abrirMesa, origen?: string }} io
 */
export async function prepararTablet(idMesa, { pedirCredencial, obtenerMesa, abrirMesa, origen = '' }) {
  const { token: credencial } = await pedirCredencial(idMesa)
  if (!credencial) throw new Error('El servidor no devolvió la credencial de la pantalla')
  const qr = await qrVigenteDeMesa(idMesa, { obtenerMesa, abrirMesa })
  return { ...qr, credencial, enlace: armarEnlaceTablet({ origen, idMesa, credencial, qrUrl: qr.qrUrl }) }
}
