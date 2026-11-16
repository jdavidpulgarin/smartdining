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
  ShieldCheck,
  Smartphone,
  ChevronLeft,
  Sliders,
  UtensilsCrossed,
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
    <div className="sd-modal-backdrop" onClick={onCerrar}>
      <form
        className="sd-card sd-table-detail-modal"
        style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={enviar}
        role="dialog"
        aria-modal="true"
        aria-label="Configurar pantalla"
      >
        <h3 className="sd-card-title" style={{ margin: 0, fontSize: 20 }}>
          Configurar pantalla{numero ? ` · Mesa ${numero}` : ''}
        </h3>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--sd-text-muted)' }}>
          Solo para el personal. Lo más fácil es pulsar «Lanzar Pantalla» o «Copiar URL Tablet» en el panel. Si no,
          inicia sesión aquí una vez: la pantalla guarda su credencial y la sesión se cierra enseguida.
        </p>
        <input
          type="email"
          required
          autoComplete="off"
          placeholder="Correo del personal"
          aria-label="Correo del personal"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="sd-input"
        />
        <input
          type="password"
          required
          autoComplete="off"
          placeholder="Contraseña"
          aria-label="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="sd-input"
        />
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--sd-red-text)', fontWeight: 700 }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="sd-btn sd-btn-secondary" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className="sd-btn sd-btn-primary" disabled={cargando}>
            {cargando ? 'Configurando…' : 'Configurar'}
          </button>
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


  return (
    <div className="sd-pantalla-page">
      {/* Fondo con foto del plato y viñeta oscura */}
      <img
        src="/img/fondo.webp"
        alt=""
        aria-hidden="true"
        className="sd-bg-photo"
        style={{ opacity: 0.35, position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', zIndex: 0 }}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />

      {/* Barra superior de la tablet */}
      <header className="sd-pantalla-topbar">
        <button
          type="button"
          className="sd-pantalla-btn-icon"
          onClick={() => navigate('/mesas')}
          title="Volver al panel"
        >
          <ChevronLeft size={20} />
          <span>SALIR</span>
        </button>

        <div className="sd-pantalla-brand">
          <div className="sd-brand-badge" aria-hidden="true">
            <span>SD</span>
          </div>
          <span className="sd-brand-text">SMARTDINING</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Socket status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontFamily: 'var(--sd-font-heading)',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 4,
              background: socketStatus === 'conectado' ? 'rgba(255,255,255,0.1)' : 'rgba(238,28,37,0.2)',
              color: socketStatus === 'conectado' ? 'var(--sd-white)' : 'var(--sd-red-text)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: socketStatus === 'conectado' ? 'var(--sd-white)' : 'var(--sd-red)',
              }}
            />
            <span>{socketStatus === 'conectado' ? 'EN VIVO' : 'SIN CONEXIÓN'}</span>
          </div>

          <span className="sd-pantalla-clock">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>

          <button
            type="button"
            className="sd-pantalla-btn-icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>

          <button
            type="button"
            className="sd-pantalla-btn-icon"
            onClick={() => setShowConfig(!showConfig)}
            title="Ajustes técnicos"
          >
            <Sliders size={18} />
          </button>
        </div>
      </header>

      {/* Banner de Rotación o Error */}
      {justRotated && (
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            background: 'var(--sd-red)',
            color: '#fff',
            padding: '8px 16px',
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'var(--sd-font-heading)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Sparkles size={16} />
          <span>¡Código QR renovado automáticamente para tu mesa!</span>
        </div>
      )}

      {errorPantalla && (
        <div
          role="alert"
          style={{
            position: 'relative',
            zIndex: 10,
            background: 'rgba(238,28,37,0.9)',
            color: '#fff',
            padding: '8px 16px',
            textAlign: 'center',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'var(--sd-font-heading)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Info size={16} />
          <span>{errorPantalla}</span>
        </div>
      )}

      {/* Contenido Central: Número de mesa en rojo gigante y QR sobre blanco */}
      <main className="sd-pantalla-center-container">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              borderRadius: 20,
              background: 'rgba(238,28,37,0.15)',
              color: 'var(--sd-red-text)',
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            <Sparkles size={14} />
            <span>BIENVENIDO A TU MESA</span>
          </div>

          <span className="sd-pantalla-pre-title">SMARTDINING EXPERIENCIA DIGITAL</span>

          <h1 className="sd-page-title sd-pantalla-giant-number">
            MESA {numeroVisible ?? '—'}
          </h1>

          {tableData?.location && (
            <p style={{ color: 'var(--sd-text-muted)', fontSize: 14, margin: '4px 0 0 0' }}>
              Sector: {tableData.location}
            </p>
          )}

          <p className="sd-pantalla-subtitle">
            {sinQr
              ? 'Mesa disponible · pide a tu mesero que la abra'
              : 'Escanea el código QR con la cámara de tu teléfono para ver la carta, ordenar y compartir comanda'}
          </p>
        </div>

        {/* QR sobre blanco en el centro */}
        <div className="sd-pantalla-qr-card">
          {sinQr ? (
            <div
              role="status"
              data-testid="tablet-mesa-disponible"
              className="sd-pantalla-qr-white-frame"
              style={{ width: 260, height: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', color: '#0a0f1d' }}
            >
              <strong style={{ fontSize: 26, lineHeight: 1.2 }}>Mesa disponible</strong>
              <span style={{ fontSize: 16, lineHeight: 1.4 }}>Pide a tu mesero que la abra</span>
            </div>
          ) : tokenQr ? (
            <div className="sd-pantalla-qr-white-frame">
              <QRCodeSVG
                value={diningUrl}
                size={260}
                level="M"
                includeMargin={false}
                fgColor="#0a0f1d"
                bgColor="#ffffff"
              />
            </div>
          ) : (
            <div className="sd-pantalla-qr-white-frame" role="status" style={{ width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16, color: '#0a0f1d', fontWeight: 700 }}>
              Esperando el código QR de la mesa. Pide al personal que abra la mesa o que configure esta pantalla.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%' }}>
            {!sinQr && tokenQr && (
              <div className="sd-pantalla-sid-meta">
                <span>Sesión activa · sid: {sid}</span>
              </div>
            )}

            {qrApuntaALocalhost && !sinQr && tokenQr && (
              <div
                className="sd-localhost-warning"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'rgba(238, 28, 37, 0.15)',
                  border: '1px solid rgba(238, 28, 37, 0.4)',
                  color: '#ff8a80',
                  fontSize: 12,
                  maxWidth: 320,
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
              >
                <Info size={14} style={{ flexShrink: 0 }} />
                <span>El QR apunta a localhost: un celular no podrá abrirlo. Configura la IP Wi-Fi en opciones.</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {conSesion ? (
                <button
                  type="button"
                  className="sd-pantalla-btn-rotate"
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
                  className="sd-pantalla-btn-rotate"
                  onClick={() => setConfigurando(true)}
                  title="Configurar pantalla (personal)"
                >
                  <Sliders size={16} />
                  <span>CONFIGURAR PANTALLA</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {configurando && (
          <ConfigurarPantalla numero={numeroVisible} onConfigurar={configurar} onCerrar={() => setConfigurando(false)} />
        )}

        {/* Instrucciones y Beneficios de comensal */}
        <div className="sd-pantalla-features-row" style={{ marginTop: 20 }}>
          <div className="sd-card sd-pantalla-feature-card">
            <Smartphone size={20} style={{ color: 'var(--sd-red-text)', marginBottom: 8 }} />
            <strong className="sd-feature-title">SIN INSTALAR APPS</strong>
            <p className="sd-feature-desc">Funciona directo desde la cámara o navegador de tu celular.</p>
          </div>
          <div className="sd-card sd-pantalla-feature-card">
            <UtensilsCrossed size={20} style={{ color: 'var(--sd-red-text)', marginBottom: 8 }} />
            <strong className="sd-feature-title">COMANDA COMPARTIDA</strong>
            <p className="sd-feature-desc">Todos los comensales pueden sumar platillos a la misma cuenta.</p>
          </div>
          <div className="sd-card sd-pantalla-feature-card">
            <ShieldCheck size={20} style={{ color: 'var(--sd-red-text)', marginBottom: 8 }} />
            <strong className="sd-feature-title">SEGURIDAD GARANTIZADA</strong>
            <p className="sd-feature-desc">
              {tieneComensales
                ? 'Sesión en curso: los pedidos y comensales conservan su cuenta activa.'
                : 'Rotación periódica automática cada 3 min mientras no haya comensales.'}
            </p>
          </div>
        </div>
      </main>

      {/* Pie de pantalla de la tablet */}
      <footer
        style={{
          position: 'relative',
          zIndex: 5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          borderTop: '1px solid var(--sd-border)',
          background: 'rgba(18, 14, 13, 0.95)',
          fontSize: 13,
          color: 'var(--sd-text-muted)',
          fontFamily: 'var(--sd-font-body)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={15} style={{ color: 'var(--sd-text)' }} />
          <span>Si necesitas asistencia de nuestro equipo, avisa a cualquier mesero en salón.</span>
        </div>
      </footer>

      {/* Cajón de Configuración para el Personal */}
      {showConfig && (
        <div
          className="sd-modal-backdrop"
          onClick={() => setShowConfig(false)}
        >
          <div
            className="sd-card sd-table-detail-modal"
            style={{ maxWidth: 540 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="sd-modal-header">
              <h3 className="sd-card-title" style={{ margin: 0, fontSize: 22 }}>
                ⚙️ Ajustes de Pantalla de Mesa #{numeroVisible ?? idMesa}
              </h3>
              <button
                type="button"
                className="sd-topbar-icon-btn"
                onClick={() => setShowConfig(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
              <div>
                <label className="sd-input-label">DESTINO DE CONEXIÓN (PARA CELULARES):</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    className={`sd-btn ${useWifiIp ? 'sd-btn-primary' : 'sd-btn-secondary'}`}
                    onClick={() => setUseWifiIp(true)}
                    style={{ fontSize: 13, flex: 1 }}
                  >
                    <Wifi size={14} />
                    <span>IP WI-FI ({hostIp})</span>
                  </button>
                  <button
                    type="button"
                    className={`sd-btn ${!useWifiIp ? 'sd-btn-primary' : 'sd-btn-secondary'}`}
                    onClick={() => setUseWifiIp(false)}
                    style={{ fontSize: 13, flex: 1 }}
                  >
                    <span>LOCALHOST</span>
                  </button>
                </div>
              </div>

              {useWifiIp && (
                <div>
                  <label className="sd-input-label">IP EN LA RED LOCAL WI-FI:</label>
                  <input
                    type="text"
                    value={hostIp}
                    onChange={(e) => setHostIp(e.target.value.trim())}
                    placeholder="192.168.1.X"
                    className="sd-input"
                  />
                  {qrApuntaALocalhost && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 6,
                        padding: '6px 10px',
                        borderRadius: 4,
                        background: 'rgba(238, 28, 37, 0.15)',
                        border: '1px solid rgba(238, 28, 37, 0.35)',
                        color: 'var(--sd-red-text, #ff6b6b)',
                        fontSize: 11,
                        lineHeight: 1.3,
                      }}
                    >
                      <Info size={14} style={{ flexShrink: 0 }} />
                      <span>
                        El QR apunta a localhost: un celular no podrá abrirlo. Escribe la IP de este PC en la red Wi-Fi.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="sd-input-label">PUERTO DEL CLIENTE (PWA):</label>
                <input
                  type="text"
                  value={clientPort}
                  onChange={(e) => setClientPort(e.target.value.trim())}
                  placeholder="5174"
                  className="sd-input"
                />
              </div>

              <div>
                <label className="sd-input-label">ENLACE CODIFICADO:</label>
                <input type="text" readOnly value={diningUrl} className="sd-input" style={{ opacity: 0.7 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <a
                  href={diningUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="sd-btn sd-btn-primary"
                  style={{ textDecoration: 'none', justifyContent: 'center' }}
                >
                  <ExternalLink size={15} />
                  <span>PROBAR ENLACE EN NUEVA PESTAÑA</span>
                </a>

                <button
                  type="button"
                  className="sd-btn sd-btn-secondary"
                  onClick={() => navigate('/mesas')}
                  style={{ justifyContent: 'center' }}
                >
                  <ChevronLeft size={15} />
                  <span>REGRESAR AL PANEL DE MESEROS</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
