import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  User,
  UserPlus,
  Utensils,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react'
import { useAuth, useTables, useSocketListener } from '../hooks'
import { obtenerCuenta, registrarComensal } from '../services/api'
import {
  unirComensales,
  buscarPorClave,
  accionError409,
} from '../utils/tomarPedido'

export function TomarPedido() {
  const { id } = useParams()
  const navigate = useNavigate()
  const idMesa = Number(id)
  const { user } = useAuth()
  const { tables } = useTables()

  const userRole = (user?.rol || user?.role || '').toLowerCase()
  const esPersonalAutorizado = userRole === 'mesero' || userRole === 'admin'

  const mesaActual = useMemo(() => {
    return tables?.find((t) => Number(t.id || t.number) === idMesa)
  }, [tables, idMesa])

  // Estado de comensales y datos de mesa
  const [presencia, setPresencia] = useState(null)
  const [cuenta, setCuenta] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)

  // Estado del flujo
  const [paso, setPaso] = useState(1) // 1: elegir comensal, 2: menu/constructor, 3: resumen/envio
  const [comensalActivo, setComensalActivo] = useState(null)

  // Formulario para registrar comensal sin celular
  const [nuevoAlias, setNuevoAlias] = useState('')
  const [registrando, setRegistrando] = useState(false)
  const [errorRegistro, setErrorRegistro] = useState(null)
  const [aliasSugerido, setAliasSugerido] = useState(null)
  const [exitoRegistro, setExitoRegistro] = useState(null)

  // Carrito local del mesero (para FASE 4 y 5)
  const [carrito, _setCarrito] = useState([])

  // Cargar cuenta de la mesa
  const cargarDatosMesa = useCallback(async () => {
    if (!idMesa) return
    try {
      setCargando(true)
      setErrorCarga(null)
      const dataCuenta = await obtenerCuenta(idMesa)
      setCuenta(dataCuenta)
    } catch (err) {
      setErrorCarga(err.message || 'Error al cargar la cuenta de la mesa')
    } finally {
      setCargando(false)
    }
  }, [idMesa])

  useEffect(() => {
    let activo = true
    if (!idMesa) return

    obtenerCuenta(idMesa)
      .then((dataCuenta) => {
        if (!activo) return
        setCuenta(dataCuenta)
        setCargando(false)
      })
      .catch((err) => {
        if (!activo) return
        setErrorCarga(err.message || 'Error al cargar la cuenta de la mesa')
        setCargando(false)
      })

    return () => {
      activo = false
    }
  }, [idMesa])

  // Escuchar eventos en vivo de presencia si el socket está disponible
  useSocketListener('mesa:presencia', (data) => {
    if (data && Number(data.id_mesa) === idMesa) {
      setPresencia(data)
    }
  })

  // Lista unificada y deduplicada de comensales según el contrato
  const comensales = useMemo(() => {
    return unirComensales({ presencia, cuenta })
  }, [presencia, cuenta])

  // Manejar selección de comensal existente
  const handleSeleccionarComensal = (alias) => {
    setComensalActivo(alias)
    setErrorRegistro(null)
    setAliasSugerido(null)
    setPaso(2)
  }

  // Registrar comensal sin celular
  const handleRegistrarComensal = async (e) => {
    e?.preventDefault?.()
    const aliasTipeado = nuevoAlias.trim()
    if (!aliasTipeado || registrando) return

    setRegistrando(true)
    setErrorRegistro(null)
    setAliasSugerido(null)
    setExitoRegistro(null)

    try {
      // POST /api/mesas/:id/comensales { alias }
      const res = await registrarComensal(idMesa, aliasTipeado)
      // REGLA DURA: El alias del 201 es el canónico normalizado por el servidor
      const aliasNormalizado = res?.alias || aliasTipeado

      setExitoRegistro(`Comensal "${aliasNormalizado}" registrado`)
      setNuevoAlias('')
      // Recargar cuenta para actualizar lista de la mesa
      await cargarDatosMesa()

      // Pasa automáticamente a tomar pedido con el alias registrado por el servidor
      setComensalActivo(aliasNormalizado)
      setPaso(2)
    } catch (err) {
      const accion = accionError409(err)

      if (accion.tipo === 'alias_en_uso') {
        setErrorRegistro('Ese nombre ya está en la mesa')
        const existente = buscarPorClave(comensales, aliasTipeado)
        if (existente) {
          setAliasSugerido(existente)
        }
      } else if (accion.tipo === 'mesa_sin_sesion') {
        setErrorRegistro('Esa mesa no tiene una sesión abierta: ábrela antes de agregar comensales')
      } else {
        setErrorRegistro(accion.mensaje || 'No se pudo registrar el comensal')
      }
    } finally {
      setRegistrando(false)
    }
  }

  // Restricción de rol
  if (!esPersonalAutorizado) {
    return (
      <div className="sd-page-container" style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
        <div className="sd-card" style={{ padding: '24px', textAlign: 'center', background: 'var(--sd-surface)' }}>
          <AlertCircle size={48} style={{ color: 'var(--sd-red)', margin: '0 auto 16px' }} />
          <h2 style={{ color: 'var(--sd-text)', marginBottom: '8px' }}>Acceso Restringido</h2>
          <p style={{ color: 'var(--sd-text-muted)', marginBottom: '20px' }}>
            Solo el personal de servicio (meseros y administradores) puede tomar pedidos desde el panel.
          </p>
          <button
            type="button"
            className="table-btn-primary"
            onClick={() => navigate('/mesas')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}
          >
            <ArrowLeft size={18} />
            <span>Volver a Mesas</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="tomar-pedido-page" style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Barra superior de navegación e información de la mesa */}
      <header
        className="tomar-pedido-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--sd-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            type="button"
            className="table-btn-secondary"
            onClick={() => navigate('/mesas')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '44px', padding: '8px 16px' }}
            aria-label="Volver a mesas"
          >
            <ArrowLeft size={18} />
            <span>Mesas</span>
          </button>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--sd-text)' }}>
                {mesaActual?.name || `Mesa ${idMesa}`}
              </h1>
              <span
                style={{
                  background: 'rgba(238, 28, 37, 0.15)',
                  color: 'var(--sd-red)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                {mesaActual?.status || mesaActual?.estado || 'Ocupada'}
              </span>
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--sd-text-muted)' }}>
              Zona {mesaActual?.location || mesaActual?.ubicacion || 'Principal'} · {comensales.length} comensal(es) activo(s)
            </span>
          </div>
        </div>

        {/* Indicador de comensal activo y carrito */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {comensalActivo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--sd-surface)',
                border: '1px solid var(--sd-border)',
                padding: '6px 14px',
                borderRadius: '8px',
              }}
            >
              <User size={16} style={{ color: 'var(--sd-gold)' }} />
              <span style={{ fontSize: '0.85rem', color: 'var(--sd-text-muted)' }}>Pidiendo para:</span>
              <strong style={{ color: 'var(--sd-text)', fontSize: '0.9rem' }}>{comensalActivo}</strong>
              <button
                type="button"
                onClick={() => setPaso(1)}
                style={{
                  marginLeft: '8px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--sd-red)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: '4px',
                }}
              >
                Cambiar
              </button>
            </div>
          )}

          {carrito.length > 0 && (
            <button
              type="button"
              className="table-btn-primary"
              onClick={() => setPaso(3)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                minHeight: '44px',
                padding: '8px 16px',
                background: 'var(--sd-red)',
              }}
            >
              <ShoppingBag size={18} />
              <span>Ver Pedido ({carrito.length})</span>
            </button>
          )}
        </div>
      </header>

      {/* PASO 1: Elegir o registrar el comensal */}
      {paso === 1 && (
        <section className="paso-elegir-comensal" style={{ maxWidth: '750px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--sd-text)', margin: '0 0 8px' }}>
              ¿Para quién es el pedido?
            </h2>
            <p style={{ color: 'var(--sd-text-muted)', fontSize: '0.9rem', margin: 0 }}>
              Elige a alguien sentado en la mesa o registra a una persona que no traiga celular.
            </p>
          </div>

          {/* Lista de comensales existentes */}
          <div
            className="seccion-comensales-existentes"
            style={{
              background: 'var(--sd-surface)',
              border: '1px solid var(--sd-border)',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={18} style={{ color: 'var(--sd-red)' }} />
                <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--sd-text)' }}>
                  Comensales en la mesa ({comensales.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={cargarDatosMesa}
                disabled={cargando}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--sd-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.8rem',
                }}
                aria-label="Actualizar lista de comensales"
              >
                <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
                <span>Actualizar</span>
              </button>
            </div>

            {errorCarga && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(238, 28, 37, 0.1)',
                  color: 'var(--sd-red)',
                  fontSize: '0.85rem',
                  marginBottom: '14px',
                }}
              >
                {errorCarga}
              </div>
            )}

            {comensales.length > 0 ? (
              <div
                className="grid-comensales"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '12px',
                }}
              >
                {comensales.map((alias) => {
                  const esActivo = comensalActivo === alias
                  return (
                    <button
                      key={alias}
                      type="button"
                      onClick={() => handleSeleccionarComensal(alias)}
                      className="btn-comensal-opcion"
                      style={{
                        minHeight: '52px',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        background: esActivo ? 'var(--sd-red)' : 'var(--sd-surface-2)',
                        border: esActivo ? '1px solid var(--sd-red)' : '1px solid var(--sd-border)',
                        color: 'var(--sd-text)',
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        transition: 'all 0.15s ease',
                        boxShadow: esActivo ? '0 0 12px rgba(238, 28, 37, 0.35)' : 'none',
                      }}
                    >
                      <User size={16} style={{ color: esActivo ? '#fff' : 'var(--sd-text-muted)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {alias}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div
                style={{
                  textAlign: 'center',
                  padding: '24px 16px',
                  color: 'var(--sd-text-muted)',
                  fontSize: '0.9rem',
                }}
              >
                {cargando ? 'Cargando comensales de la mesa...' : 'Aún no hay comensales registrados en esta mesa.'}
              </div>
            )}
          </div>

          {/* Registro de persona sin celular */}
          <div
            className="seccion-registrar-sin-celular"
            style={{
              background: 'var(--sd-surface)',
              border: '1px solid var(--sd-border)',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <UserPlus size={18} style={{ color: 'var(--sd-gold)' }} />
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--sd-text)' }}>
                Registrar a alguien sin celular
              </h3>
            </div>
            <p style={{ color: 'var(--sd-text-muted)', fontSize: '0.85rem', margin: '0 0 16px' }}>
              Si un cliente no trae teléfono, asígnale un nombre o apodo para que su comanda quede separada y cuente en «dividir igual».
            </p>

            <form onSubmit={handleRegistrarComensal} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={nuevoAlias}
                  onChange={(e) => {
                    setNuevoAlias(e.target.value)
                    setErrorRegistro(null)
                    setAliasSugerido(null)
                  }}
                  placeholder="Ej. Señora sin celular, Tío Carlos..."
                  style={{
                    flex: '1 1 240px',
                    minHeight: '48px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'var(--sd-surface-2)',
                    border: errorRegistro ? '1px solid var(--sd-red)' : '1px solid var(--sd-border)',
                    color: 'var(--sd-text)',
                    fontSize: '0.95rem',
                    outline: 'none',
                  }}
                  disabled={registrando}
                  aria-label="Nombre o apodo del comensal"
                />

                <button
                  type="submit"
                  disabled={registrando || !nuevoAlias.trim()}
                  className="table-btn-primary"
                  style={{
                    minHeight: '48px',
                    padding: '10px 20px',
                    background: 'var(--sd-red)',
                    borderColor: 'var(--sd-red)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    opacity: registrando || !nuevoAlias.trim() ? 0.6 : 1,
                    cursor: registrando || !nuevoAlias.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  <UserPlus size={18} />
                  <span>{registrando ? 'Registrando...' : 'Registrar y pedir'}</span>
                </button>
              </div>

              {/* Mensajes de error y sugerencia de alias existente */}
              {errorRegistro && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'rgba(238, 28, 37, 0.1)',
                    border: '1px solid var(--sd-red)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--sd-red)', fontSize: '0.85rem' }}>
                    <AlertCircle size={16} />
                    <span>{errorRegistro}</span>
                  </div>

                  {aliasSugerido && (
                    <div style={{ marginTop: '4px' }}>
                      <button
                        type="button"
                        onClick={() => handleSeleccionarComensal(aliasSugerido)}
                        className="table-btn-primary"
                        style={{
                          minHeight: '44px',
                          padding: '6px 14px',
                          fontSize: '0.85rem',
                          background: 'var(--sd-gold)',
                          color: '#000',
                          fontWeight: 600,
                        }}
                      >
                        Pedir para «{aliasSugerido}»
                      </button>
                    </div>
                  )}
                </div>
              )}

              {exitoRegistro && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(47, 107, 58, 0.15)',
                    color: '#4ade80',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <CheckCircle2 size={16} />
                  <span>{exitoRegistro}</span>
                </div>
              )}
            </form>
          </div>
        </section>
      )}

      {/* Placeholder para PASO 2 y PASO 3 (se integran en FASE 4 y FASE 5) */}
      {paso === 2 && (
        <section className="paso-menu-container" style={{ padding: '16px 0' }}>
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              background: 'var(--sd-surface)',
              borderRadius: '12px',
              border: '1px solid var(--sd-border)',
            }}
          >
            <Utensils size={36} style={{ color: 'var(--sd-red)', margin: '0 auto 12px' }} />
            <h2 style={{ color: 'var(--sd-text)', margin: '0 0 8px' }}>
              Menú y Carta para {comensalActivo}
            </h2>
            <p style={{ color: 'var(--sd-text-muted)', fontSize: '0.9rem', margin: '0 0 20px' }}>
              Paso 2: Selección de platos e ingredientes para el comensal.
            </p>
            <button
              type="button"
              className="table-btn-secondary"
              onClick={() => setPaso(1)}
              style={{ minHeight: '44px', padding: '8px 18px' }}
            >
              <ArrowLeft size={16} />
              <span>Cambiar comensal</span>
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
