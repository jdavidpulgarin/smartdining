// Copiado y adaptado desde frontend-cliente/src/pages/Carrito.jsx
// Adaptado para frontend-restaurante en J-16

import { useState, useMemo } from 'react'
import {
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  AlertCircle,
  Send,
  ArrowLeft,
  UserCheck,
  RefreshCw,
} from 'lucide-react'
import { enviarPedido, registrarComensal } from '../../services/api'
import { puedeAbrirMesa } from '../../utils/estadoMesa'
import {
  armarPedido,
  accionErrorEnvio,
  itemTieneFaltante,
  reemplazarAlias,
  totalesPorComensal,
} from '../../utils/tomarPedido'

export function ResumenPedido({
  idMesa,
  estadoMesa,
  numeroMesa,
  carrito = [],
  onModificarCantidad,
  onEliminarItem,
  onActualizarCarrito,
  onVolverAlMenu,
  onPedidoExitoso,
}) {
  const [notasGenerales, setNotasGenerales] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [faltantesStock, setFaltantesStock] = useState([])
  const [comensalARegistrar, setComensalARegistrar] = useState(null)
  const [reintentandoComensal, setReintentandoComensal] = useState(false)
  const [reintentoHecho, setReintentoHecho] = useState(false)

  const { grupos: agrupadoPorComensal, total: totalPedido } = useMemo(
    () => totalesPorComensal(carrito),
    [carrito]
  )

  // Enviar el pedido a la API
  const handleEnviarPedido = async (itemsParaEnviar = carrito) => {
    if (!itemsParaEnviar || itemsParaEnviar.length === 0 || enviando) return
    // Reservada o en mantenimiento: el pedido abre la mesa, así que se confirma.
    if (!puedeAbrirMesa({ estado: estadoMesa, numero: numeroMesa ?? idMesa }, (m) => window.confirm(m))) return

    setEnviando(true)
    setErrorEnvio(null)
    setFaltantesStock([])
    setComensalARegistrar(null)

    try {
      const payload = armarPedido({
        idMesa,
        items: itemsParaEnviar,
        notasGenerales,
      })

      const respuesta = await enviarPedido(payload)
      onPedidoExitoso(respuesta)
    } catch (err) {
      const accion = accionErrorEnvio(err)

      if (accion.tipo === 'sin_stock') {
        const faltantes = accion.faltantes || []
        const nombres = faltantes.map((f) => f?.nombre).filter(Boolean)
        setErrorEnvio(
          nombres.length > 0
            ? `Algunos platos o ingredientes están agotados. Quita del pedido: ${nombres.join(', ')}.`
            : 'Algunos platos o ingredientes están agotados. Revisa los ítems resaltados en rojo y quítalos para poder enviar la comanda.'
        )
        setFaltantesStock(faltantes)
      } else if (accion.tipo === 'comensal_no_registrado') {
        const aliasFaltante = accion.alias || itemsParaEnviar[0]?.comensal || 'Comensal'
        setErrorEnvio(`La persona «${aliasFaltante}» no está registrada en la mesa (la reserva pudo vencer).`)
        setComensalARegistrar(aliasFaltante)
      } else if (accion.tipo === 'reintentar') {
        setErrorEnvio(accion.mensaje)
      } else {
        setErrorEnvio(accion.mensaje || 'Error al enviar la comanda a cocina')
      }
    } finally {
      setEnviando(false)
    }
  }

  // Re-registrar comensal y reintentar envío UNA vez
  const handleReRegistrarYReintentar = async () => {
    if (!comensalARegistrar || reintentandoComensal || reintentoHecho) return

    setReintentandoComensal(true)
    setErrorEnvio(null)

    try {
      // 1. POST /api/mesas/:id/comensales { alias }
      const res = await registrarComensal(idMesa, comensalARegistrar)
      // Usar el alias normalizado que devuelve el servidor
      const aliasCanonico = res?.alias || comensalARegistrar

      // 2. Reemplazar alias en los ítems del carrito
      const carritoActualizado = reemplazarAlias(carrito, comensalARegistrar, aliasCanonico)
      onActualizarCarrito(carritoActualizado)

      setComensalARegistrar(null)
      setReintentoHecho(true)

      // 3. Reintentar el envío UNA sola vez
      await handleEnviarPedido(carritoActualizado)
    } catch (err) {
      const accion = accionErrorEnvio(err)
      setErrorEnvio(`No se pudo volver a registrar: ${accion.mensaje}`)
    } finally {
      setReintentandoComensal(false)
    }
  }

  if (carrito.length === 0) {
    return (
      <div
        className="resumen-vacio tp-tarjeta tp-resumen-vacio"
      >
        <ShoppingBag size={48} className="tp-resumen-vacio-icono" />
        <h2 className="tp-resumen-vacio-titulo">La comanda está vacía</h2>
        <p className="tp-resumen-vacio-texto">
          No has agregado ningún plato al pedido de esta mesa.
        </p>
        <button
          type="button"
          onClick={onVolverAlMenu}
          className="tp-btn tp-btn-ambar"
        >
          <ArrowLeft size={16} />
          <span>Ir a la carta</span>
        </button>
      </div>
    )
  }

  return (
    <div className="resumen-pedido-container tp-resumen">
      {/* Cabecera del resumen */}
      <div className="tp-resumen-cabeza">
        <div>
          <h2 className="tp-resumen-titulo">
            Resumen de la Comanda
          </h2>
          <span className="tp-resumen-meta">
            Mesa #{numeroMesa ?? idMesa} · {carrito.length} {carrito.length === 1 ? 'ítem' : 'ítems'} en total
          </span>
        </div>

        <button
          type="button"
          onClick={onVolverAlMenu}
          className="tp-btn tp-btn-claro"
        >
          <ArrowLeft size={16} />
          <span>Seguir agregando platos</span>
        </button>
      </div>

      {/* Alertas de error de envío */}
      {errorEnvio && (
        <div className="tp-aviso tp-aviso-error tp-aviso-columna">
          <div className="tp-aviso-linea tp-aviso-fuerte">
            <AlertCircle size={18} />
            <span>{errorEnvio}</span>
          </div>

          {/* Acción para comensal no registrado */}
          {comensalARegistrar && (
            <div className="tp-aviso-accion">
              <button
                type="button"
                disabled={reintentandoComensal || reintentoHecho}
                onClick={handleReRegistrarYReintentar}
                className="tp-btn tp-btn-ambar tp-btn-mini"
              >
                <UserCheck size={16} />
                <span>
                  {reintentandoComensal
                    ? 'Registrando y reintentando...'
                    : `Volver a registrar a «${comensalARegistrar}»`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lista agrupada por comensal */}
      <div className="tp-grupos">
        {agrupadoPorComensal.map(({ comensal, items, subtotalComensal }) => (
          <div
            key={comensal}
            className="tp-grupo"
          >
            {/* Encabezado del grupo de comensal */}
            <div className="tp-grupo-cabeza">
              <div className="tp-grupo-quien">
                <span className="tp-grupo-nombre">
                  {comensal}
                </span>
                <span className="tp-grupo-cuenta">
                  ({items.length} {items.length === 1 ? 'plato' : 'platos'})
                </span>
              </div>

              <strong className="tp-grupo-subtotal">
                ${subtotalComensal.toLocaleString('es-CO')}
              </strong>
            </div>

            {/* Ítems del comensal */}
            <div className="tp-grupo-items">
              {items.map((item) => {
                const tieneFaltante = itemTieneFaltante(item, faltantesStock)
                const subtotalItem = (Number(item.precio) || 0) * (item.cantidad || 1)

                return (
                  <div
                    key={item.indiceOriginal}
                    className={tieneFaltante ? 'tp-item tp-item-faltante' : 'tp-item'}
                  >
                    <div className="tp-item-info">
                      <div className="tp-item-nombre-fila">
                        <strong className="tp-item-nombre">
                          {item.nombre}
                        </strong>
                        {tieneFaltante && (
                          <span className="tp-etiqueta tp-etiqueta-agotado">
                            AGOTADO
                          </span>
                        )}
                      </div>

                      {/* Detalles de ingredientes si es personalizable */}
                      {Array.isArray(item.ingredientes) && item.ingredientes.length > 0 && (
                        <div className="tp-item-ingredientes">
                          {item.ingredientes.map((ig, i) => (
                            <span key={i} className="tp-item-ingrediente">
                              · {ig.nombre || `Ingr #${ig.id_ingrediente}`}
                              {ig.porcion && ig.porcion !== 'normal' ? ` (${ig.porcion})` : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Notas para cocina */}
                      {item.notas && (
                        <div className="tp-item-nota">
                          Nota: {item.notas}
                        </div>
                      )}

                      <div className="tp-item-unitario">
                        ${Number(item.precio).toLocaleString('es-CO')} c/u
                      </div>
                    </div>

                    {/* Controles de cantidad y precio */}
                    <div className="tp-item-controles">
                      <div className="tp-cantidad">
                        <button
                          type="button"
                          onClick={() => onModificarCantidad(item.indiceOriginal, -1)}
                          aria-label={`Reducir ${item.nombre}`}
                          className="tp-cantidad-btn"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="tp-cantidad-num">
                          {item.cantidad || 1}
                        </span>
                        <button
                          type="button"
                          disabled={(item.cantidad || 1) >= 20}
                          onClick={() => onModificarCantidad(item.indiceOriginal, 1)}
                          aria-label={`Aumentar ${item.nombre}`}
                          className="tp-cantidad-btn"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      <strong className="tp-item-subtotal">
                        ${subtotalItem.toLocaleString('es-CO')}
                      </strong>

                      <button
                        type="button"
                        onClick={() => onEliminarItem(item.indiceOriginal)}
                        aria-label={`Quitar ${item.nombre}`}
                        className="tp-quitar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Notas generales para cocina */}
      <div className="tp-tarjeta tp-notas">
        <label
          htmlFor="input-notas-generales"
          className="tp-label"
        >
          Notas generales de la comanda (opcional, máx. 500 caracteres)
        </label>
        <input
          id="input-notas-generales"
          type="text"
          maxLength={500}
          value={notasGenerales}
          onChange={(e) => setNotasGenerales(e.target.value)}
          placeholder="Ej. Servir platos al mismo tiempo, comensales tienen prisa..."
          className="tp-input"
        />
      </div>

      {/* Barra de total y botón de envío */}
      <div className="tp-total">
        <div>
          <span className="tp-total-rotulo">Total de la Comanda</span>
          <div className="tp-total-cifra">
            ${totalPedido.toLocaleString('es-CO')}
          </div>
        </div>

        <div className="tp-total-acciones">
          <button
            type="button"
            disabled={enviando || carrito.length === 0}
            onClick={() => handleEnviarPedido(carrito)}
            className={enviando ? 'tp-btn tp-btn-ambar tp-btn-enviar tp-btn-enviando' : 'tp-btn tp-btn-ambar tp-btn-enviar'}
          >
            {enviando ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                <span>Enviando comanda...</span>
              </>
            ) : (
              <>
                <Send size={18} />
                <span>Enviar comanda a cocina</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
