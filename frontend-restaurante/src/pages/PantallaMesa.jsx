import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { io } from 'socket.io-client'
import {
  Wifi,
  Sparkles,
  Maximize2,
  Minimize2,
  ExternalLink,
  ChevronLeft,
  Sliders,
  Info,
  RotateCw,
} from 'lucide-react'
import { useTables } from '../hooks'
import {
  solicitarTokenPantalla,
  rotarTokenQrMesa,
  notificarQrRotado,
  decodificarTokenQr,
  haySesionPersonal,
  mesaPublica,
  configurarTabletConLogin,
} from '../services/qrService'
import {
  extraerHostDeUrl,
  esHostLocal,
  obtenerHostPorDefecto,
  resolverDiningUrl,
} from '../utils/qrUrl'
import { errorDeRotacion, tabletSinQr, tokenDeUrl, accionTabletAlReconectar } from '../utils/qrRotacion'
import { buscarMesa } from '../utils/mesaActualizada'
import { tomarFragmentoTablet, guardarTablet, olvidarTablet, urlConToken } from '../utils/enlaceTablet'
import '../styles/pantalla-mesa.css'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

// localStorage de la tablet: solo la credencial de pantalla y el último QR.
const almacen = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Configurar una tablet física que no tiene credencial: alguien del personal
 * inicia sesión UNA vez solo para obtenerla (y el QR vigente). La contraseña y
 * la sesión del personal no se guardan en la tablet.
 */
function ConfigurarPantalla({ numero, onConfigurar, onCerrar }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  const enviar = async (e) => {
    e.preventDefault()
    if (cargando) return
    setCargando(true)
    setError('')
    try {
      await onConfigurar(email.trim(), password)
    } catch (err) {
      setError(err?.message || 'No se pudo configurar la pantalla')
    } finally {
      setPassword('')
      setCargando(false)
    }
  }

  return (
    <div className="mesa-velo" onClick={onCerrar}>
      <form
        className="mesa-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={enviar}
        role="dialog"
        aria-modal="true"
        aria-label="Configurar pantalla"
      >
        <div className="mesa-banda">
          <span>CONFIGURAR PANTALLA</span>
          {numero ? <small>MESA {numero}</small> : null}
        </div>
        <div className="mesa-panel-cuerpo">
          <h3>SOLO PERSONAL</h3>
          <p>
            Solo para el personal. Lo más fácil es pulsar «Lanzar Pantalla» o «Copiar URL Tablet» en el panel. Si no,
            inicia sesión aquí una vez: la pantalla guarda su credencial y la sesión se cierra enseguida.
          </p>
          <div className="mesa-campo">
            <span className="mesa-campo-lbl" aria-hidden="true">CORREO DEL PERSONAL</span>
            <input
              type="email"
              required
              autoComplete="off"
              placeholder="Correo del personal"
              aria-label="Correo del personal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mesa-inp"
            />
          </div>
          <div className="mesa-campo">
            <span className="mesa-campo-lbl" aria-hidden="true">CONTRASEÑA</span>
            <input
              type="password"
              required
              autoComplete="off"
              placeholder="Contraseña"
              aria-label="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mesa-inp"
            />
          </div>
          {error && (
            <p role="alert" className="mesa-panel-error">
              {error}
            </p>
          )}
          <div className="mesa-fila">
            <button type="button" className="mesa-btn mesa-btn-claro" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="mesa-btn" disabled={cargando}>
              {cargando ? 'Configurando…' : 'Configurar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export function PantallaMesa() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { tables, pedidosActivos, cargarMesas } = useTables()

  // La ruta lleva el id_mesa, no el número: con mesas de id ≠ número la tablet
  // escuchaba otra mesa. El número que se muestra sale de la propia mesa.
  const idMesa = Number(id) || 1
  const tableData = buscarMesa(tables, idMesa)

  // Lo que dejó el panel en el # (credencial de pantalla y QR vigente) o lo ya
  // guardado en esta tablet (utils/enlaceTablet.js). El # se quita de la barra.
  const [tablet, setTablet] = useState(() =>
    tomarFragmentoTablet(almacen(), idMesa, typeof window !== 'undefined' ? window.location.hash : '')
  )
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
  }, [])
  // Estado y número de la mesa por la ruta pública (la tablet no tiene sesión).
  const [mesaPub, setMesaPub] = useState(null)
  const numeroVisible = tableData?.numero ?? tableData?.number ?? mesaPub?.numero ?? null
  const conSesion = haySesionPersonal()
  const [configurando, setConfigurando] = useState(false)

  // Token QR y URL activa de la mesa
  // Sin token real de la mesa NO se inventa uno: el QR esperaría un token que el
  // backend rechaza. La tablet espera el de qr:actualizado, el que le dejó el panel
  // o el de ROTAR QR (solo con sesión del personal).
  const [tokenQr, setTokenQr] = useState(() => tableData?.token_qr || tablet.token || null)
  const [qrUrl, setQrUrl] = useState(() => tableData?.qr_url || tablet.qrUrl || '')
  const [prevTableToken, setPrevTableToken] = useState(tableData?.token_qr)
  if (tableData?.token_qr !== prevTableToken) {
    setPrevTableToken(tableData?.token_qr)
    setTokenQr(tableData?.token_qr || null)
  }
  const [prevTableQrUrl, setPrevTableQrUrl] = useState(tableData?.qr_url)
  if (tableData?.qr_url !== prevTableQrUrl) {
    setPrevTableQrUrl(tableData?.qr_url)
    setQrUrl(tableData?.qr_url || '')
  }

  // Mesa liberada: el QR que tenía la tablet quedó revocado. Hasta que llegue
  // uno nuevo se muestra «Mesa disponible» (utils/qrRotacion.js, tabletSinQr).
  const [sinQr, setSinQr] = useState(() =>
    tabletSinQr(false, { tipo: 'mesa', estado: tableData?.estado, token_qr: tableData?.token_qr })
  )
  const claveMesa = `${tableData?.estado}|${tableData?.token_qr}`
  const [prevClaveMesa, setPrevClaveMesa] = useState(claveMesa)
  if (claveMesa !== prevClaveMesa) {
    setPrevClaveMesa(claveMesa)
    setSinQr((actual) => tabletSinQr(actual, { tipo: 'mesa', estado: tableData?.estado, token_qr: tableData?.token_qr }))
  }

  const [justRotated, setJustRotated] = useState(false)


  // Estado del socket exclusivo de la tablet (rol: 'pantalla')
  const [socketStatus, setSocketStatus] = useState('conectando') // 'conectado' | 'reconectando' | 'desconectado'

  // Pantalla completa y configuración
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  // Configuración de red para comensales con celular (sin IP fija escrita a mano)
  const backendUrl = qrUrl || tableData?.qr_url || ''
  const hostBackend = extraerHostDeUrl(backendUrl)
  const defaultHost = obtenerHostPorDefecto(backendUrl)

  const [useWifiIp, setUseWifiIp] = useState(true)
  const [hostIp, setHostIp] = useState(defaultHost)
  const [prevHostBackend, setPrevHostBackend] = useState(hostBackend)

  if (hostBackend && hostBackend !== prevHostBackend) {
    setPrevHostBackend(hostBackend)
    setHostIp(hostBackend)
  }

  const defaultClientPort = (import.meta.env && import.meta.env.VITE_CLIENTE_PORT) || '5174'
  const [clientPort, setClientPort] = useState(defaultClientPort)
  const [loadingAction, setLoadingAction] = useState(false)
  // Error visible en la tablet (rotación o credencial de pantalla fallidas)
  const [errorPantalla, setErrorPantalla] = useState('')

  // El QR usa la url del backend y se regenera con hostIp manteniendo puerto y token
  const diningUrl = resolverDiningUrl({
    backendUrl,
    token: tokenQr,
    tableNumber: idMesa,
    hostIp,
    useWifiIp,
    fallbackPort: clientPort,
  })

  // Aviso cuando el QR apunta a localhost y un celular no podrá abrirlo
  const qrApuntaALocalhost = useWifiIp && esHostLocal(hostIp)

  const infoToken = decodificarTokenQr(tokenQr)
  const sid = infoToken?.sid || (tokenQr ? tokenQr.slice(-8) : 'activo')

  // Detectar si la mesa tiene pedidos activos o comensales
  const pedidosMesa = (pedidosActivos || []).filter(
    (p) => Number(p.id_mesa) === idMesa && p.estado !== 'cancelado'
  )
  const tieneComensales = pedidosMesa.length > 0 || Boolean(tableData?.comensales?.length > 0)

  // Hora actual para el reloj de la pantalla
  const [currentTime, setCurrentTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Un QR nuevo (del panel, de ROTAR QR o de qr:actualizado): se muestra y se
  // guarda en la tablet. qr:actualizado trae solo el token: se pone en la url.
  const qrUrlRef = useRef(qrUrl)
  useEffect(() => {
    qrUrlRef.current = qrUrl
  }, [qrUrl])
  const ponerQr = useCallback(
    (token, url) => {
      if (!token) return
      const nueva = url || urlConToken(qrUrlRef.current, token)
      setTokenQr(token)
      setQrUrl(nueva)
      qrUrlRef.current = nueva
      // Sin url conocida se guarda el token (la tablet arma la url del comensal).
      guardarTablet(almacen(), idMesa, nueva ? { qrUrl: nueva } : { qrUrl: null, token })
      setSinQr((actual) => tabletSinQr(actual, { tipo: 'qr', token_qr: token }))
    },
    [idMesa]
  )

  // La mesa quedó libre (mesa:liberada o la ruta pública): su QR está revocado.
  const quedoLibre = useCallback(() => {
    setSinQr((actual) => tabletSinQr(actual, { tipo: 'mesa:liberada' }))
    guardarTablet(almacen(), idMesa, { qrUrl: null })
  }, [idMesa])

  // Estado real de la mesa por la ruta pública GET /api/mesas/:id (sin sesión):
  // al abrir la tablet y al reconectar. Libre → «Mesa disponible».
  const revisarMesa = useCallback(async () => {
    const m = await mesaPublica(idMesa)
    setMesaPub(m)
    if (m?.estado === 'disponible') quedoLibre()
    return m
  }, [idMesa, quedoLibre])
  useEffect(() => {
    let cancelado = false
    mesaPublica(idMesa)
      .then((m) => {
        if (cancelado) return
        setMesaPub(m)
        if (m?.estado === 'disponible') quedoLibre()
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [idMesa, quedoLibre])

  // T3: la tablet NO rota el QR por su cuenta. Lo rota el socket-server cada
  // 3 min solo mientras la mesa está vacía (conoce la presencia real) y avisa
  // con qr:actualizado. Antes la tablet tenía su propio temporizador: con la
  // mesa vacía rotaba dos veces, y antes del #253 rotaba sin guarda y dejaba
  // fuera a quien ya estaba dentro. El botón manual también pide solo_si_vacia:
  // con gente en la mesa el backend responde 409 mesa_con_comensales y el QR
  // se queda, con un aviso (un clic sin querer ya no saca a nadie).
  // Solo con sesión del personal en esta pestaña: la tablet no la tiene.
  const handleRotarQr = useCallback(async () => {
    if (loadingAction) return
    setLoadingAction(true)
    setErrorPantalla('')
    try {
      const res = await rotarTokenQrMesa(idMesa, undefined, { soloSiVacia: true })
      ponerQr(res?.token || tokenDeUrl(res?.url), res?.url)
      setJustRotated(true)
      setTimeout(() => setJustRotated(false), 2500)
    } catch (err) {
      setErrorPantalla(errorDeRotacion(err).texto)
    } finally {
      setLoadingAction(false)
    }
  }, [loadingAction, idMesa, ponerQr])

  // Una tablet sin credencial: alguien del personal inicia sesión UNA vez solo
  // para prepararla (credencial de pantalla + QR vigente si la mesa está
  // ocupada). La sesión del personal no se guarda: se descarta enseguida.
  const configurar = useCallback(
    async (email, password) => {
      const r = await configurarTabletConLogin(idMesa, email, password)
      guardarTablet(almacen(), idMesa, { credencial: r.credencial })
      setMesaPub({ estado: r.estado, numero: r.numero })
      if (r.estado === 'ocupada' && r.token) ponerQr(r.token, r.qrUrl)
      else if (r.estado === 'disponible') quedoLibre()
      setErrorPantalla('')
      setConfigurando(false)
      setTablet((t) => ({ ...t, credencial: r.credencial }))
    },
    [idMesa, ponerQr, quedoLibre]
  )

  // Inicializar conexión Socket.io con rol 'pantalla' para esta mesa
  const credencial = tablet.credencial
  useEffect(() => {
    let socket = null
    let isCancelled = false

    async function initSocketPantalla() {
      // 1. La credencial de PANTALLA: la que dejó el panel (guardada en la
      //    tablet) o, si en esta pestaña hay sesión del personal, se pide
      //    (POST /qr/pantalla). Sin ninguna: hay que configurar la tablet.
      let cred = credencial
      if (!cred && haySesionPersonal()) {
        try {
          cred = (await solicitarTokenPantalla(idMesa)).token
        } catch (err) {
          if (isCancelled) return
          setSocketStatus('desconectado')
          setErrorPantalla(err.message)
          return
        }
        if (isCancelled) return
        guardarTablet(almacen(), idMesa, { credencial: cred })
      }
      if (!cred) {
        setSocketStatus('desconectado')
        setConfigurando(true)
        return
      }
      setErrorPantalla('')

      // 2. Conectar al socket server con la credencial de pantalla
      socket = io(SOCKET_URL, {
        auth: { token: cred },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 20,
      })

      let yaConecto = false
      socket.on('connect', () => {
        if (isCancelled) return
        setSocketStatus('conectado')
        // Reconexión: lo que pasó sin red no se reenvía (#239). Se mira el
        // estado real de la mesa (utils/qrRotacion.js, accionTabletAlReconectar).
        if (yaConecto) revisarAlReconectar()
        yaConecto = true
      })

      async function revisarAlReconectar() {
        let mesa
        try {
          mesa = await revisarMesa() // libre → «Mesa disponible»
        } catch {
          return // sin respuesta: se queda lo que hay; el próximo evento lo corrige
        }
        if (isCancelled) return
        cargarMesas?.()
        // Ocupada: con sesión del personal se pide el QR vigente (solo_si_vacia).
        // La tablet sin sesión se queda con el que tiene; si la mesa está vacía,
        // el socket-server la rota en ≤ 3 min y llega por qr:actualizado.
        if (accionTabletAlReconectar(mesa?.estado) === 'pedir_qr' && haySesionPersonal()) {
          try {
            const res = await notificarQrRotado(idMesa)
            if (isCancelled) return
            ponerQr(res?.token || tokenDeUrl(res?.url), res?.url)
          } catch (err) {
            if (isCancelled) return
            // Con gente en la mesa (409) el QR no pudo rotar: se queda el que hay.
            if (!errorDeRotacion(err).conComensales) setErrorPantalla(errorDeRotacion(err).texto)
          }
        }
      }

      socket.on('disconnect', () => {
        if (isCancelled) return
        setSocketStatus('desconectado')
      })

      socket.on('connect_error', (err) => {
        if (isCancelled) return
        // Credencial vencida o rechazada: se olvida y se pide configurar.
        if (/TOKEN_INVALIDO|AUTH_REQUERIDA/.test(err?.message || '')) {
          olvidarTablet(almacen(), idMesa)
          socket.disconnect()
          setSocketStatus('desconectado')
          setConfigurando(true)
          return
        }
        setSocketStatus('reconectando')
        console.warn(`[Tablet Mesa ${idMesa}] Error de socket:`, err.message)
      })

      // 3. Escuchar evento de Roberto: 'qr:actualizado'
      socket.on('qr:actualizado', (data) => {
        if (isCancelled) return
        if (data?.token_qr) {
          ponerQr(data.token_qr, data.url)
          setJustRotated(true)
          setTimeout(() => setJustRotated(false), 3000)
        }
      })

      // Al liberar, el QR queda revocado: «Mesa disponible» hasta el siguiente.
      socket.on('mesa:liberada', () => {
        if (isCancelled) return
        quedoLibre()
      })
    }

    initSocketPantalla()

    return () => {
      isCancelled = true
      if (socket) {
        socket.disconnect()
      }
    }
  }, [idMesa, cargarMesas, credencial, revisarMesa, ponerQr, quedoLibre])

  // Manejo de pantalla completa
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }


  // Hora del dispositivo, sin segundos (8:45 p. m.).
  const hora = currentTime.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="mesa-pagina tema-comanda">
      {/* Barra superior de la tablet */}
      <header className="mesa-top">
        <div className="mesa-top-lado">
          <button type="button" className="mesa-ib" onClick={() => navigate('/mesas')} title="Volver al panel">
            <ChevronLeft size={18} />
            <span>SALIR</span>
          </button>
        </div>

        <div className="mesa-marca">
          <span className="mesa-sd" aria-hidden="true">SD</span>
          <b>SMARTDINING</b>
        </div>

        <div className="mesa-top-lado mesa-top-der">
          {/* Estado real del socket de la pantalla */}
          <span className={`mesa-vivo${socketStatus === 'conectado' ? '' : ' mesa-vivo-off'}`}>
            <i aria-hidden="true"></i>
            {socketStatus === 'conectado' ? 'EN VIVO' : 'SIN CONEXIÓN'}
          </span>

          <span className="mesa-reloj">{hora}</span>

          <button
            type="button"
            className="mesa-ib"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>

          <button
            type="button"
            className="mesa-ib"
            onClick={() => setShowConfig(!showConfig)}
            title="Ajustes técnicos"
          >
            <Sliders size={18} />
          </button>
        </div>
      </header>
      <div className="mesa-franja" aria-hidden="true"></div>

      {/* QR renovado (llegó qr:actualizado o se rotó a mano) */}
      {justRotated && (
        <div className="mesa-aviso mesa-aviso-ok">
          <Sparkles size={16} />
          <span>¡Código QR renovado automáticamente para tu mesa!</span>
        </div>
      )}

      {errorPantalla && (
        <div role="alert" className="mesa-aviso mesa-aviso-error">
          <Info size={16} />
          <span>{errorPantalla}</span>
        </div>
      )}

      <main className="mesa-centro">
        <section className="mesa-izq">
          <div className="mesa-sobre">BIENVENIDO A TU MESA</div>
          <h1 className="mesa-numero">MESA {numeroVisible ?? '—'}</h1>
          {tableData?.location && <p className="mesa-sector">Sector: {tableData.location}</p>}
          <p className="mesa-frase">Pide y paga desde tu celular, sin filas ni esperas.</p>

          <ol className="mesa-pasos">
            <li className="mesa-paso">
              <b aria-hidden="true">1</b>
              <div>
                <h3>ESCANEA EL QR</h3>
                <span>Con la cámara del celular. Sin instalar apps.</span>
              </div>
            </li>
            <li className="mesa-paso">
              <b aria-hidden="true">2</b>
              <div>
                <h3>ARMA TU PEDIDO</h3>
                <span>Todos en la mesa suman platos a la misma comanda.</span>
              </div>
            </li>
            <li className="mesa-paso">
              <b aria-hidden="true">3</b>
              <div>
                <h3>PAGA Y SIGUE TU PLATO</h3>
                <span>Cada quien paga lo suyo y ve cuándo sale de cocina.</span>
              </div>
            </li>
          </ol>
        </section>

        <section className="mesa-der">
          <div className="mesa-ticket">
            <span className="mesa-mascota" aria-hidden="true"></span>
            <div className="mesa-banda">
              <span>COMANDA</span>
              <small>
                MESA {numeroVisible ?? '—'}
                {tableData?.location ? ` · ${tableData.location}` : ''}
              </small>
            </div>

            {sinQr ? (
              <div role="status" data-testid="tablet-mesa-disponible" className="mesa-libre">
                <svg viewBox="0 0 120 120" aria-hidden="true">
                  <circle cx="60" cy="60" r="56" fill="#f6e7d4" />
                  <rect x="28" y="54" width="64" height="10" rx="5" fill="#120c0c" />
                  <path d="M40 64v28M80 64v28" stroke="#120c0c" strokeWidth="8" strokeLinecap="round" />
                  <path d="M44 54c0-12 7-20 16-20s16 8 16 20" fill="none" stroke="#ffb02e" strokeWidth="8" strokeLinecap="round" />
                </svg>
                <strong>Mesa disponible</strong>
                <span>Pide a tu mesero que la abra</span>
              </div>
            ) : tokenQr ? (
              <div className="mesa-qrzona">
                <div className="mesa-qr sd-pantalla-qr-white-frame">
                  <QRCodeSVG
                    value={diningUrl}
                    size={260}
                    level="M"
                    includeMargin={false}
                    fgColor="#0a0f1d"
                    bgColor="#ffffff"
                  />
                  <span className="mesa-scan" aria-hidden="true"></span>
                </div>
                <h2 className="mesa-escaneame">ESCANÉAME PARA PEDIR</h2>
              </div>
            ) : (
              <div className="mesa-espera" role="status">
                Esperando el código QR de la mesa. Pide al personal que abra la mesa o que configure esta pantalla.
              </div>
            )}

            <div className="mesa-corte" aria-hidden="true"></div>

            <div className="mesa-talon">
              <div className="mesa-estado">
                {!sinQr && tokenQr && (
                  <>
                    <b>
                      <i aria-hidden="true"></i>
                      SESIÓN ACTIVA
                    </b>
                    <small>sid: {sid}</small>
                    <small>
                      {tieneComensales
                        ? 'Con comensales: el QR queda fijo.'
                        : 'Sin comensales: el QR se renueva solo cada 3 min.'}
                    </small>
                  </>
                )}
              </div>

              {conSesion ? (
                <button
                  type="button"
                  className="mesa-accion"
                  onClick={handleRotarQr}
                  disabled={loadingAction}
                  title="Rotar código QR"
                >
                  <RotateCw size={16} className={loadingAction ? 'spin' : ''} />
                  <span>ROTAR QR</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="mesa-accion"
                  onClick={() => setConfigurando(true)}
                  title="Configurar pantalla (personal)"
                >
                  <Sliders size={16} />
                  <span>CONFIGURAR PANTALLA</span>
                </button>
              )}
            </div>

            {qrApuntaALocalhost && !sinQr && tokenQr && (
              <div className="mesa-localhost">
                <Info size={14} style={{ flexShrink: 0 }} />
                <span>El QR apunta a localhost: un celular no podrá abrirlo. Configura la IP Wi-Fi en opciones.</span>
              </div>
            )}
          </div>
        </section>

        {configurando && (
          <ConfigurarPantalla numero={numeroVisible} onConfigurar={configurar} onCerrar={() => setConfigurando(false)} />
        )}
      </main>

      {/* Pie de asistencia */}
      <footer className="mesa-pie">
        <Info size={18} />
        <span>Si necesitas asistencia de nuestro equipo, avisa a cualquier mesero en salón.</span>
      </footer>

      {/* Panel lateral de ajustes para el personal */}
      {showConfig && (
        <div className="mesa-velo" onClick={() => setShowConfig(false)}>
          <div
            className="mesa-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="mesa-banda">
              <span>AJUSTES · MESA {numeroVisible ?? idMesa}</span>
              <button type="button" className="mesa-panel-cerrar" onClick={() => setShowConfig(false)}>
                ✕
              </button>
            </div>

            <div className="mesa-panel-cuerpo">
              <div className="mesa-campo">
                <label className="mesa-campo-lbl">DESTINO DE CONEXIÓN (PARA CELULARES):</label>
                <div className="mesa-fila">
                  <button
                    type="button"
                    className={`mesa-btn${useWifiIp ? '' : ' mesa-btn-claro'}`}
                    onClick={() => setUseWifiIp(true)}
                  >
                    <Wifi size={14} />
                    <span>IP WI-FI ({hostIp})</span>
                  </button>
                  <button
                    type="button"
                    className={`mesa-btn${!useWifiIp ? '' : ' mesa-btn-claro'}`}
                    onClick={() => setUseWifiIp(false)}
                  >
                    <span>LOCALHOST</span>
                  </button>
                </div>
              </div>

              {useWifiIp && (
                <div className="mesa-campo">
                  <label className="mesa-campo-lbl">IP EN LA RED LOCAL WI-FI:</label>
                  <input
                    type="text"
                    value={hostIp}
                    onChange={(e) => setHostIp(e.target.value.trim())}
                    placeholder="192.168.1.X"
                    className="mesa-inp"
                  />
                  {qrApuntaALocalhost && (
                    <div className="mesa-panel-aviso">
                      <Info size={14} style={{ flexShrink: 0 }} />
                      <span>
                        El QR apunta a localhost: un celular no podrá abrirlo. Escribe la IP de este PC en la red Wi-Fi.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="mesa-campo">
                <label className="mesa-campo-lbl">PUERTO DEL CLIENTE (PWA):</label>
                <input
                  type="text"
                  value={clientPort}
                  onChange={(e) => setClientPort(e.target.value.trim())}
                  placeholder="5174"
                  className="mesa-inp"
                />
              </div>

              <div className="mesa-campo">
                <label className="mesa-campo-lbl">ENLACE CODIFICADO:</label>
                <input type="text" readOnly value={diningUrl} className="mesa-inp" />
              </div>

              <a href={diningUrl} target="_blank" rel="noreferrer" className="mesa-btn">
                <ExternalLink size={15} />
                <span>PROBAR ENLACE EN NUEVA PESTAÑA</span>
              </a>

              <button type="button" className="mesa-btn mesa-btn-claro" onClick={() => navigate('/mesas')}>
                <ChevronLeft size={15} />
                <span>REGRESAR AL PANEL DE MESEROS</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
