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
import {
  armarPedido,
  accionError409,
  itemTieneFaltante,
  reemplazarAlias,
} from '../../utils/tomarPedido'

export function ResumenPedido({
  idMesa,
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

  // Agrupar ítems por comensal
  const agrupadoPorComensal = useMemo(() => {
    const grupos = new Map()

    carrito.forEach((item, index) => {
      const alias = item.comensal || 'Sin comensal'
      if (!grupos.has(alias)) {
        grupos.set(alias, [])
      }
      grupos.get(alias).push({ ...item, indiceOriginal: index })
    })

    return Array.from(grupos.entries()).map(([comensal, items]) => {
      const subtotalComensal = items.reduce(
        (acc, it) => acc + (Number(it.precio) || 0) * (it.cantidad || 1),
        0
      )
      return { comensal, items, subtotalComensal }
    })
  }, [carrito])

  // Total acumulado
  const totalPedido = useMemo(() => {
    return carrito.reduce(
      (acc, it) => acc + (Number(it.precio) || 0) * (it.cantidad || 1),
      0
    )
  }, [carrito])

  // Enviar el pedido a la API
  const handleEnviarPedido = async (itemsParaEnviar = carrito) => {
    if (!itemsParaEnviar || itemsParaEnviar.length === 0 || enviando) return

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
      const accion = accionError409(err)

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
      const accion = accionError409(err)
      setErrorEnvio(`No se pudo volver a registrar: ${accion.mensaje}`)
    } finally {
      setReintentandoComensal(false)
    }
  }

  if (carrito.length === 0) {
    return (
      <div
        className="resumen-vacio"
        style={{
          background: 'var(--sd-surface)',
          border: '1px solid var(--sd-border)',
          borderRadius: '12px',
          padding: '40px 20px',
          textAlign: 'center',
          maxWidth: '600px',
          margin: '20px auto',
        }}
      >
        <ShoppingBag size={48} style={{ color: 'var(--sd-text-muted)', margin: '0 auto 16px' }} />
        <h2 style={{ color: 'var(--sd-text)', marginBottom: '8px' }}>La comanda está vacía</h2>
        <p style={{ color: 'var(--sd-text-muted)', marginBottom: '24px' }}>
          No has agregado ningún plato al pedido de esta mesa.
        </p>
        <button
          type="button"
          onClick={onVolverAlMenu}
          className="table-btn-primary"
          style={{
            minHeight: '44px',
            padding: '10px 20px',
            background: 'var(--sd-red)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <ArrowLeft size={16} />
          <span>Ir a la carta</span>
        </button>
      </div>
    )
  }

  return (
    <div className="resumen-pedido-container" style={{ maxWidth: '850px', margin: '0 auto' }}>
      {/* Cabecera del resumen */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--sd-text)' }}>
            Resumen de la Comanda
          </h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--sd-text-muted)' }}>
            Mesa #{idMesa} · {carrito.length} {carrito.length === 1 ? 'ítem' : 'ítems'} en total
          </span>
        </div>

        <button
          type="button"
          onClick={onVolverAlMenu}
          className="table-btn-secondary"
          style={{
            minHeight: '44px',
            padding: '8px 16px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <ArrowLeft size={16} />
          <span>Seguir agregando platos</span>
        </button>
      </div>

      {/* Alertas de error de envío */}
      {errorEnvio && (
        <div
          style={{
            padding: '16px',
            borderRadius: '10px',
            background: 'rgba(238, 28, 37, 0.1)',
            border: '1px solid var(--sd-red)',
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--sd-red)', fontWeight: 600 }}>
            <AlertCircle size={18} />
            <span>{errorEnvio}</span>
          </div>

          {/* Acción para comensal no registrado */}
          {comensalARegistrar && (
            <div style={{ marginTop: '4px' }}>
              <button
                type="button"
                disabled={reintentandoComensal || reintentoHecho}
                onClick={handleReRegistrarYReintentar}
                className="table-btn-primary"
                style={{
                  minHeight: '44px',
                  padding: '8px 16px',
                  background: 'var(--sd-gold)',
                  color: '#000',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: reintentandoComensal || reintentoHecho ? 'not-allowed' : 'pointer',
                  opacity: reintentandoComensal || reintentoHecho ? 0.6 : 1,
                }}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
        {agrupadoPorComensal.map(({ comensal, items, subtotalComensal }) => (
          <div
            key={comensal}
            style={{
              background: 'var(--sd-surface)',
              border: '1px solid var(--sd-border)',
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            {/* Encabezado del grupo de comensal */}
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--sd-surface-2)',
                borderBottom: '1px solid var(--sd-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    background: 'var(--sd-surface)',
                    border: '1px solid var(--sd-border)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: 'var(--sd-text)',
                  }}
                >
                  {comensal}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--sd-text-muted)' }}>
                  ({items.length} {items.length === 1 ? 'plato' : 'platos'})
                </span>
              </div>

              <strong style={{ fontSize: '0.95rem', color: 'var(--sd-text)' }}>
                ${subtotalComensal.toLocaleString('es-CO')}
              </strong>
            </div>

            {/* Ítems del comensal */}
            <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {items.map((item) => {
                const tieneFaltante = itemTieneFaltante(item, faltantesStock)
                const subtotalItem = (Number(item.precio) || 0) * (item.cantidad || 1)

                return (
                  <div
                    key={item.indiceOriginal}
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      background: tieneFaltante ? 'rgba(238, 28, 37, 0.08)' : 'transparent',
                      borderRadius: tieneFaltante ? '8px' : 0,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ color: 'var(--sd-text)', fontSize: '0.92rem' }}>
                          {item.nombre}
                        </strong>
                        {tieneFaltante && (
                          <span
                            style={{
                              background: 'var(--sd-red)',
                              color: '#fff',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            AGOTADO
                          </span>
                        )}
                      </div>

                      {/* Detalles de ingredientes si es personalizable */}
                      {Array.isArray(item.ingredientes) && item.ingredientes.length > 0 && (
                        <div
                          style={{
                            fontSize: '0.78rem',
                            color: 'var(--sd-text-muted)',
                            marginTop: '2px',
                          }}
                        >
                          {item.ingredientes.map((ig, i) => (
                            <span key={i} style={{ marginRight: '6px' }}>
                              · {ig.nombre || `Ingr #${ig.id_ingrediente}`}
                              {ig.porcion && ig.porcion !== 'normal' ? ` (${ig.porcion})` : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Notas para cocina */}
                      {item.notas && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--sd-gold)', fontStyle: 'italic', marginTop: '2px' }}>
                          Nota: {item.notas}
                        </div>
                      )}

                      <div style={{ fontSize: '0.8rem', color: 'var(--sd-text-muted)', marginTop: '2px' }}>
                        ${Number(item.precio).toLocaleString('es-CO')} c/u
                      </div>
                    </div>

                    {/* Controles de cantidad y precio */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: 'var(--sd-surface-2)',
                          border: '1px solid var(--sd-border)',
                          borderRadius: '8px',
                          padding: '2px',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onModificarCantidad(item.indiceOriginal, -1)}
                          aria-label={`Reducir ${item.nombre}`}
                          style={{
                            minWidth: '36px',
                            minHeight: '36px',
                            background: 'none',
                            border: 'none',
                            color: 'var(--sd-text)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Minus size={14} />
                        </button>
                        <span style={{ minWidth: '20px', textAlign: 'center', fontWeight: 700, fontSize: '0.9rem', color: 'var(--sd-text)' }}>
                          {item.cantidad || 1}
                        </span>
                        <button
                          type="button"
                          disabled={(item.cantidad || 1) >= 20}
                          onClick={() => onModificarCantidad(item.indiceOriginal, 1)}
                          aria-label={`Aumentar ${item.nombre}`}
                          style={{
                            minWidth: '36px',
                            minHeight: '36px',
                            background: 'none',
                            border: 'none',
                            color: 'var(--sd-text)',
                            cursor: (item.cantidad || 1) >= 20 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: (item.cantidad || 1) >= 20 ? 0.4 : 1,
                          }}
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      <strong style={{ fontSize: '0.95rem', color: 'var(--sd-text)', minWidth: '75px', textAlign: 'right' }}>
                        ${subtotalItem.toLocaleString('es-CO')}
                      </strong>

                      <button
                        type="button"
                        onClick={() => onEliminarItem(item.indiceOriginal)}
                        aria-label={`Quitar ${item.nombre}`}
                        style={{
                          minWidth: '36px',
                          minHeight: '36px',
                          background: 'none',
                          border: 'none',
                          color: 'var(--sd-text-muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '6px',
                        }}
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
      <div
        style={{
          background: 'var(--sd-surface)',
          border: '1px solid var(--sd-border)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px',
        }}
      >
        <label
          htmlFor="input-notas-generales"
          style={{
            display: 'block',
            fontSize: '0.85rem',
            color: 'var(--sd-text-muted)',
            marginBottom: '6px',
          }}
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
          style={{
            width: '100%',
            minHeight: '44px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'var(--sd-surface-2)',
            border: '1px solid var(--sd-border)',
            color: 'var(--sd-text)',
            fontSize: '0.9rem',
            outline: 'none',
          }}
        />
      </div>

      {/* Barra de total y botón de envío */}
      <div
        style={{
          background: 'var(--sd-surface)',
          border: '1px solid var(--sd-border)',
          borderRadius: '12px',
          padding: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <span style={{ fontSize: '0.85rem', color: 'var(--sd-text-muted)' }}>Total de la Comanda</span>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--sd-text)' }}>
            ${totalPedido.toLocaleString('es-CO')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            disabled={enviando || carrito.length === 0}
            onClick={() => handleEnviarPedido(carrito)}
            className="table-btn-primary"
            style={{
              minHeight: '48px',
              padding: '12px 28px',
              fontSize: '1rem',
              fontWeight: 700,
              background: enviando ? 'var(--sd-border)' : 'var(--sd-red)',
              borderColor: enviando ? 'var(--sd-border)' : 'var(--sd-red)',
              cursor: enviando ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              opacity: enviando ? 0.6 : 1,
            }}
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
