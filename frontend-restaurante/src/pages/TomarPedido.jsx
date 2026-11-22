import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  User,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react'
import { useAuth, useTables, useSocketListener } from '../hooks'
import { obtenerCuenta, registrarComensal } from '../services/api'
import {
  unirComensales,
  accionError409,
  opcionPedirExistente,
} from '../utils/tomarPedido'
import { MenuCatalogo } from '../components/tomar-pedido/MenuCatalogo'
import { ResumenPedido } from '../components/tomar-pedido/ResumenPedido'
import { buscarMesa } from '../utils/mesaActualizada'

export function TomarPedido() {
  const { id } = useParams()
  const navigate = useNavigate()
  const idMesa = Number(id)
  const { user } = useAuth()
  const { tables, presenciaPorMesa } = useTables()

  const userRole = (user?.rol || user?.role || '').toLowerCase()
  const esPersonalAutorizado = userRole === 'mesero' || userRole === 'admin'

  const mesaActual = useMemo(() => {
    return buscarMesa(tables, idMesa)
  }, [tables, idMesa])

  // Estado de comensales y datos de mesa
  const [presenciaLocal, setPresenciaLocal] = useState(null)
  const [cuenta, setCuenta] = useState(null)
  const [comensalesSesion, setComensalesSesion] = useState([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)

  const presencia = presenciaLocal || presenciaPorMesa?.[idMesa] || null

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
  const [carrito, setCarrito] = useState([])
  const [mensajeExitoPedido, setMensajeExitoPedido] = useState(null)

  const totalItemsEnCarrito = useMemo(() => {
    return carrito.reduce((acc, it) => acc + (it.cantidad || 1), 0)
  }, [carrito])

  const handleAgregarAlCarrito = (item) => {
    setCarrito((prev) => {
      // Si es plato estándar idéntico (mismo id_plato, mismo comensal, sin notas ni ingredientes), suma cantidad
      const indiceIdentico = prev.findIndex(
        (p) =>
          p.id_plato === item.id_plato &&
          p.comensal === item.comensal &&
          !p.notas &&
          !item.notas &&
          (!p.ingredientes || p.ingredientes.length === 0) &&
          (!item.ingredientes || item.ingredientes.length === 0)
      )

      if (indiceIdentico !== -1) {
        const copia = [...prev]
        const actual = copia[indiceIdentico]
        copia[indiceIdentico] = {
          ...actual,
          cantidad: Math.min(20, (actual.cantidad || 1) + (item.cantidad || 1)),
        }
        return copia
      }

      return [...prev, item]
    })
  }

  const handleModificarCantidad = (indice, delta) => {
    setCarrito((prev) => {
      const copia = [...prev]
      const item = copia[indice]
      if (!item) return prev
      const nuevaCantidad = (item.cantidad || 1) + delta
      if (nuevaCantidad <= 0) {
        copia.splice(indice, 1)
        return copia
      }
      copia[indice] = {
        ...item,
        cantidad: Math.min(20, nuevaCantidad),
      }
      return copia
    })
  }

  const handleEliminarItem = (indice) => {
    setCarrito((prev) => prev.filter((_, idx) => idx !== indice))
  }

  const handlePedidoExitoso = (resultado) => {
    setMensajeExitoPedido(
      `¡Comanda enviada a cocina! Pedido ${resultado?.codigo_pedido || `#${resultado?.id_pedido}`}`
    )
    setCarrito([])
    setTimeout(() => {
      navigate('/mesas')
    }, 1500)
  }

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
      setPresenciaLocal(data)
    }
  })

  // Si entra un pedido nuevo para esta mesa, recargar la cuenta para reflejar sus comensales
  useSocketListener('order:created', (data) => {
    if (data?.pedido && Number(data.pedido.id_mesa) === idMesa) {
      cargarDatosMesa()
    }
  })

  // Lista unificada y deduplicada de comensales según el contrato
  const comensales = useMemo(() => {
    const basePresencia = presencia
      ? {
          ...presencia,
          comensales: [...(presencia.comensales || []), ...comensalesSesion],
        }
      : comensalesSesion.length > 0
        ? { comensales: comensalesSesion }
        : null
    return unirComensales({ presencia: basePresencia, cuenta })
  }, [presencia, cuenta, comensalesSesion])

  // Manejar selección de comensal existente
  const handleSeleccionarComensal = (alias) => {
    setComensalActivo(alias)
    setComensalesSesion((prev) => (prev.includes(alias) ? prev : [...prev, alias]))
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
      setComensalesSesion((prev) =>
        prev.includes(aliasNormalizado) ? prev : [...prev, aliasNormalizado]
      )
      // Recargar cuenta para actualizar lista de la mesa
      await cargarDatosMesa()

      // Pasa automáticamente a tomar pedido con el alias registrado por el servidor
      setComensalActivo(aliasNormalizado)
      setPaso(2)
    } catch (err) {
      const accion = accionError409(err)

      if (accion.tipo === 'alias_en_uso') {
        setErrorRegistro('Ese nombre ya está en la mesa')
        let listaParaBuscar = comensales
        if (!accion.alias?.trim()) {
          try {
            const cuentaActualizada = await obtenerCuenta(idMesa)
            setCuenta(cuentaActualizada)
            listaParaBuscar = unirComensales({
              presencia,
              cuenta: cuentaActualizada,
            })
          } catch {
            // Si falla la recarga de cuenta, se busca en la lista disponible
          }
        }
        // backendCanoniza = true: confirmado en backend/src/controllers/pedidos.controller.js
        // (resolverAliasCanonicos líneas 225-300, aliasDelComensal líneas 145-161 y crear líneas 330-348)
        const existente = opcionPedirExistente({
          error: err,
          lista: listaParaBuscar,
          texto: aliasTipeado,
          backendCanoniza: true,
        })
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
      <div className="tema-comanda tp-pagina tp-restringido">
        <div className="tp-tarjeta tp-restringido-tarjeta">
          <AlertCircle size={48} className="tp-restringido-icono" />
          <h2 className="tp-restringido-titulo">Acceso Restringido</h2>
          <p className="tp-restringido-texto">
            Solo el personal de servicio (meseros y administradores) puede tomar pedidos desde el panel.
          </p>
          <button
            type="button"
            className="tp-btn tp-btn-ambar"
            onClick={() => navigate('/mesas')}
          >
            <ArrowLeft size={18} />
            <span>Volver a Mesas</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="tomar-pedido-page tema-comanda tp-pagina">
      {/* Barra superior de navegación e información de la mesa */}
      <header
        className="tomar-pedido-header tp-cabecera"
      >
        <div className="tp-cabecera-izq">
          <button
            type="button"
            className="tp-btn tp-btn-claro"
            onClick={() => navigate('/mesas')}
            aria-label="Volver a mesas"
          >
            <ArrowLeft size={18} />
            <span>Mesas</span>
          </button>

          <div className="tp-mesa">
            <div className="tp-mesa-fila">
              <h1 className="tp-mesa-titulo">
                {mesaActual?.name || `Mesa ${idMesa}`}
              </h1>
              <span className="tp-estado">
                {mesaActual?.status || mesaActual?.estado || 'Ocupada'}
              </span>
            </div>
            <span className="tp-mesa-meta">
              Zona {mesaActual?.location || mesaActual?.ubicacion || 'Principal'} · {comensales.length} comensal(es) activo(s)
            </span>
          </div>
        </div>

        {/* Indicador de comensal activo y carrito */}
        <div className="tp-cabecera-der">
          {comensalActivo && (
            <div className="tp-para">
              <User size={16} className="tp-para-icono" />
              <span className="tp-para-rotulo">Pidiendo para:</span>
              <strong className="tp-para-nombre">{comensalActivo}</strong>
              <button
                type="button"
                onClick={() => setPaso(1)}
                className="tp-enlace"
              >
                Cambiar
              </button>
            </div>
          )}

          {carrito.length > 0 && (
            <button
              type="button"
              className="tp-btn tp-btn-ambar"
              onClick={() => setPaso(3)}
            >
              <ShoppingBag size={18} />
              <span>Ver Pedido ({carrito.length})</span>
            </button>
          )}
        </div>
      </header>

      {/* PASO 1: Elegir o registrar el comensal */}
      {paso === 1 && (
        <section className="paso-elegir-comensal tp-paso1">
          <div className="tp-intro">
            <h2 className="tp-intro-titulo">
              ¿Para quién es el pedido?
            </h2>
            <p className="tp-intro-texto">
              Elige a alguien sentado en la mesa o registra a una persona que no traiga celular.
            </p>
          </div>

          {/* Lista de comensales existentes */}
          <div
            className="seccion-comensales-existentes tp-tarjeta tp-tarjeta-franja"
          >
            <div className="tp-tarjeta-cabeza">
              <div className="tp-tarjeta-titulo-fila">
                <User size={18} className="tp-icono" />
                <h3 className="tp-tarjeta-titulo">
                  Comensales en la mesa ({comensales.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={cargarDatosMesa}
                disabled={cargando}
                className="tp-enlace tp-actualizar"
                aria-label="Actualizar lista de comensales"
              >
                <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
                <span>Actualizar</span>
              </button>
            </div>

            {errorCarga && (
              <div className="tp-aviso tp-aviso-error">
                {errorCarga}
              </div>
            )}

            {comensales.length > 0 ? (
              <div
                className="grid-comensales tp-comensales"
              >
                {comensales.map((alias) => {
                  const esActivo = comensalActivo === alias
                  return (
                    <button
                      key={alias}
                      type="button"
                      onClick={() => handleSeleccionarComensal(alias)}
                      className={esActivo ? 'btn-comensal-opcion tp-comensal tp-comensal-activo' : 'btn-comensal-opcion tp-comensal'}
                    >
                      <User size={16} className="tp-comensal-icono" />
                      <span className="tp-comensal-nombre">
                        {alias}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="tp-vacio">
                {cargando ? 'Cargando comensales de la mesa...' : 'Aún no hay comensales registrados en esta mesa.'}
              </div>
            )}
          </div>

          {/* Registro de persona sin celular */}
          <div
            className="seccion-registrar-sin-celular tp-tarjeta tp-tarjeta-franja"
          >
            <div className="tp-tarjeta-titulo-fila tp-tarjeta-titulo-sola">
              <UserPlus size={18} className="tp-icono" />
              <h3 className="tp-tarjeta-titulo">
                Registrar a alguien sin celular
              </h3>
            </div>
            <p className="tp-tarjeta-texto">
              Si un cliente no trae teléfono, asígnale un nombre o apodo para que su comanda quede a su nombre y en la Caja se le pueda cobrar solo lo suyo.
            </p>

            <form onSubmit={handleRegistrarComensal} className="tp-form">
              <div className="tp-form-fila">
                <input
                  type="text"
                  value={nuevoAlias}
                  onChange={(e) => {
                    setNuevoAlias(e.target.value)
                    setErrorRegistro(null)
                    setAliasSugerido(null)
                  }}
                  placeholder="Ej. Señora sin celular, Tío Carlos..."
                  className={errorRegistro ? 'tp-input tp-input-alias tp-input-error' : 'tp-input tp-input-alias'}
                  disabled={registrando}
                  aria-label="Nombre o apodo del comensal"
                />

                <button
                  type="submit"
                  disabled={registrando || !nuevoAlias.trim()}
                  className="tp-btn tp-btn-ambar"
                >
                  <UserPlus size={18} />
                  <span>{registrando ? 'Registrando...' : 'Registrar y pedir'}</span>
                </button>
              </div>

              {/* Mensajes de error y sugerencia de alias existente */}
              {errorRegistro && (
                <div className="tp-aviso tp-aviso-error tp-aviso-columna">
                  <div className="tp-aviso-linea">
                    <AlertCircle size={16} />
                    <span>{errorRegistro}</span>
                  </div>

                  {aliasSugerido && (
                    <div className="tp-aviso-accion">
                      <button
                        type="button"
                        onClick={() => handleSeleccionarComensal(aliasSugerido)}
                        className="tp-btn tp-btn-ambar tp-btn-mini"
                      >
                        Pedir para «{aliasSugerido}»
                      </button>
                    </div>
                  )}
                </div>
              )}

              {exitoRegistro && (
                <div className="tp-aviso tp-aviso-ok">
                  <CheckCircle2 size={16} />
                  <span>{exitoRegistro}</span>
                </div>
              )}
            </form>
          </div>
        </section>
      )}

      {/* Mensaje global de pedido enviado con éxito */}
      {mensajeExitoPedido && (
        <div className="tp-aviso tp-aviso-ok tp-aviso-grande">
          <CheckCircle2 size={24} />
          <span>{mensajeExitoPedido}</span>
        </div>
      )}

      {/* PASO 2: Menú y Constructor de platos */}
      {paso === 2 && (
        <section className="paso-menu-container tp-paso">
          <MenuCatalogo
            comensal={comensalActivo}
            onCambiarComensal={() => setPaso(1)}
            onAgregarItem={handleAgregarAlCarrito}
            onIrAResumen={() => setPaso(3)}
            totalItemsEnCarrito={totalItemsEnCarrito}
          />
        </section>
      )}

      {/* PASO 3: Resumen de la comanda y envío a cocina */}
      {paso === 3 && (
        <section className="paso-resumen-container tp-paso">
          <ResumenPedido
            idMesa={idMesa}
            estadoMesa={mesaActual?.estado || mesaActual?.status}
            numeroMesa={mesaActual?.numero ?? mesaActual?.number}
            carrito={carrito}
            onModificarCantidad={handleModificarCantidad}
            onEliminarItem={handleEliminarItem}
            onActualizarCarrito={setCarrito}
            onVolverAlMenu={() => setPaso(2)}
            onPedidoExitoso={handlePedidoExitoso}
          />
        </section>
      )}
    </div>
  )
}
