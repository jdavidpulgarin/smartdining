import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  QrCode,
  Download,
  RefreshCw,
  Copy,
  Check,
  Printer,
  X,
  ExternalLink,
  Wifi,
  Smartphone,
  LogOut,
  Sparkles,
  ShieldCheck,
  Clock,
  Tablet,
  Monitor,
  Play,
  Pause,
  RotateCw,
  AlertCircle,
} from 'lucide-react'
import { decodificarTokenQr, prepararTabletDesdePanel } from '../services/qrService'
import { useSocketListener, useTables } from '../hooks'
import {
  ROTACION_SOCKET_SEGUNDOS,
  RENOVAR_CADA_SEGUNDOS,
  REINTENTOS_MAXIMOS,
  REINTENTO_SEGUNDOS,
  puedeRotarSolo,
  errorDeRotacion,
  hayPresencia,
} from '../utils/qrRotacion'
import {
  extraerHostDeUrl,
  esHostLocal,
  obtenerHostPorDefecto,
  resolverDiningUrl,
} from '../utils/qrUrl'

export function QRModal({
  table,
  onClose,
  onUpdateToken,
  onOpenTable,
  onFreeTable,
}) {
  const [copied, setCopied] = useState(false)
  const [copiedTablet, setCopiedTablet] = useState(false)
  const [errorTablet, setErrorTablet] = useState('')
  const [preparandoTablet, setPreparandoTablet] = useState(false)
  const [token, setToken] = useState(table?.token_qr || '')
  const [prevTableToken, setPrevTableToken] = useState(table?.token_qr)
  if (table?.token_qr !== prevTableToken) {
    setPrevTableToken(table?.token_qr)
    setToken(table?.token_qr || '')
  }

  const [qrUrl, setQrUrl] = useState(table?.qr_url || '')
  const [prevTableQrUrl, setPrevTableQrUrl] = useState(table?.qr_url)
  if (table?.qr_url !== prevTableQrUrl) {
    setPrevTableQrUrl(table?.qr_url)
    setQrUrl(table?.qr_url || '')
  }

  const [loadingAction, setLoadingAction] = useState(false)
  const [justRotated, setJustRotated] = useState(false)
  const [autoRotacionHabilitada, setAutoRotacionHabilitada] = useState(true)
  const [errorRotacion, setErrorRotacion] = useState(null)
  // El backend dijo 409 mesa_con_comensales: el QR queda fijo aunque el panel
  // todavía no sepa de esos comensales.
  const [fijadoPorBackend, setFijadoPorBackend] = useState(false)

  const qrRef = useRef(null)
  const { pedidosActivos, presenciaPorMesa } = useTables()

  const tableId = Number(table?.id_mesa ?? table?.id)
  const isDisponible = (table?.status || '').toLowerCase() === 'disponible'
  const isOcupada = (table?.status || '').toLowerCase() === 'ocupada'

  // Determinar si hay comensales o pedidos activos en la mesa
  const pedidosMesa = (pedidosActivos || []).filter(
    (p) =>
      Number(p.id_mesa) === tableId &&
      p.estado !== 'cancelado'
  )
  // Presencia en vivo del socket-server (mesa:presencia, room:admin): quién está
  // conectado y quién está sin celular. No ve a quien entró y apagó el
  // teléfono sin pedir nada: eso lo cuida el backend (solo_si_vacia).
  const tieneComensalesOpedidos =
    fijadoPorBackend ||
    pedidosMesa.length > 0 ||
    Boolean(table?.comensales && table.comensales.length > 0) ||
    hayPresencia(presenciaPorMesa?.[tableId])

  // Cuándo se obtuvo el token que se muestra. 0 = no se sabe (el que había en
  // memoria al abrir el modal): con la mesa vacía, el socket-server pudo haberlo
  // rotado ya, así que se pide uno nuevo antes de mostrarlo.
  const [renovadoEn, setRenovadoEn] = useState(0)
  const [ahora, setAhora] = useState(() => Date.now())
  // Al abrir el modal con la mesa abierta y vacía: QR nuevo antes de mostrar nada.
  const [pendienteApertura, setPendienteApertura] = useState(() =>
    puedeRotarSolo({ ocupada: isOcupada, tieneComensales: tieneComensalesOpedidos, token })
  )
  const reintentos = useRef(0)
  const temporizadorReintento = useRef(null)
  const enCurso = useRef(false)
  // La versión más reciente de ejecutarRotacion, para el reintento diferido.
  const rotarRef = useRef(null)

  // Copia inmediata de renovadoEn para el reloj: el estado llega un render tarde
  // y un tic justo después de renovar vería la hora vieja y volvería a rotar.
  const renovadoRef = useRef(0)
  const marcarRenovado = useCallback(() => {
    renovadoRef.current = Date.now()
    setRenovadoEn(renovadoRef.current)
    setAhora(Date.now())
    setErrorRotacion(null)
    setPendienteApertura(false)
    reintentos.current = 0
  }, [])

  // Escuchar en vivo si el backend o la tablet rota el QR de esta mesa (evento qr:actualizado)
  useSocketListener('qr:actualizado', (data) => {
    if (data?.id_mesa && Number(data.id_mesa) === tableId && data.token_qr) {
      setToken(data.token_qr)
      if (data?.url) setQrUrl(data.url)
      marcarRenovado()
      setJustRotated(true)
      setTimeout(() => setJustRotated(false), 2000)
    }
  })

  /**
   * Pide un QR nuevo (POST /mesas/:id/rotar-qr). `motivo`: 'manual' (Nuevo QR,
   * Generar nuevo, Rotar QR), 'apertura' (al abrir el modal), 'tiempo' (antes
   * de que lo rote el socket-server) o 'reintento'. Solo 'manual' avisa con un
   * toast; nunca rota solo con comensales dentro. Si falla, no se inventa
   * ningún QR: se dice por qué y, si es pasajero (503, sin conexión), se
   * reintenta.
   */
  const ejecutarRotacion = useCallback(
    async (motivo = 'manual') => {
      if (enCurso.current || !onUpdateToken) return
      if (tieneComensalesOpedidos) {
        setPendienteApertura(false)
        return
      }
      enCurso.current = true
      clearTimeout(temporizadorReintento.current)
      setLoadingAction(true)
      try {
        // Todas, también la manual, piden que el backend se niegue (409
        // mesa_con_comensales) si la mesa tiene pedidos o nombres reservados:
        // protege a comensales que el panel no ve (#336). Solo la manual avisa.
        const automatica = motivo !== 'manual'
        const res = await onUpdateToken(tableId, { silencioso: automatica, soloSiVacia: true })
        if (!res?.token) throw new Error('El servidor no devolvió el nuevo código QR de la mesa')
        setToken(res.token)
        if (res?.url) setQrUrl(res.url)
        marcarRenovado()
        setJustRotated(true)
        setTimeout(() => setJustRotated(false), 2500)
      } catch (err) {
        const e = errorDeRotacion(err)
        setPendienteApertura(false)
        if (e.conComensales) {
          // El aviso de "QR fijo" ya sale en la tarjeta de rotación.
          setFijadoPorBackend(true)
          setErrorRotacion(null)
        } else {
          setErrorRotacion(e.texto)
        }
        if (e.reintentar && reintentos.current < REINTENTOS_MAXIMOS) {
          reintentos.current += 1
          temporizadorReintento.current = setTimeout(() => rotarRef.current?.('reintento'), REINTENTO_SEGUNDOS * 1000)
        } else {
          // Sin más intentos automáticos: a los 3 minutos sale "QR vencido ·
          // Generar nuevo" y lo pide el personal.
          reintentos.current = REINTENTOS_MAXIMOS
        }
      } finally {
        enCurso.current = false
        setLoadingAction(false)
      }
    },
    [onUpdateToken, tableId, tieneComensalesOpedidos, marcarRenovado]
  )

  useEffect(() => {
    rotarRef.current = ejecutarRotacion
  }, [ejecutarRotacion])

  // Al abrir el modal con la mesa abierta y vacía, un QR nuevo.
  const pidioAlAbrir = useRef(false)
  useEffect(() => {
    if (pidioAlAbrir.current || !pendienteApertura) return
    pidioAlAbrir.current = true
    ejecutarRotacion('apertura')
  }, [pendienteApertura, ejecutarRotacion])

  useEffect(() => () => clearTimeout(temporizadorReintento.current), [])

  // Reloj de 1 s mientras la mesa está abierta: renueva antes de los 3 minutos
  // del socket-server (si la auto-renovación está activa y la mesa vacía).
  const rotaSola = puedeRotarSolo({ ocupada: isOcupada, tieneComensales: tieneComensalesOpedidos, token })

  // Lo que mira cada tic del reloj, siempre con los valores del último render.
  // Tras agotar los reintentos no vuelve a intentar solo: queda "QR vencido ·
  // Generar nuevo" hasta que alguien lo pida.
  const revisarRef = useRef(null)
  useEffect(() => {
    revisarRef.current = () => {
      const desde = renovadoRef.current
      if (!rotaSola || !autoRotacionHabilitada || !desde || enCurso.current) return
      if (reintentos.current > 0) return
      if ((Date.now() - desde) / 1000 >= RENOVAR_CADA_SEGUNDOS) ejecutarRotacion('tiempo')
    }
  }, [rotaSola, autoRotacionHabilitada, ejecutarRotacion])

  useEffect(() => {
    if (!isOcupada || !token) return undefined
    const interval = setInterval(() => {
      setAhora(Date.now())
      revisarRef.current?.()
    }, 1000)
    return () => clearInterval(interval)
  }, [isOcupada, token])

  const edadSegundos = renovadoEn ? Math.floor((ahora - renovadoEn) / 1000) : null

  // Vencido: mesa vacía y el token tiene (o puede tener) más de 3 minutos, o
  // falló pedir uno nuevo al abrir. Con comensales el QR queda fijo y no vence.
  const qrVencido =
    rotaSola &&
    !pendienteApertura &&
    (renovadoEn === 0 || edadSegundos >= ROTACION_SOCKET_SEGUNDOS)
  const qrVigente = Boolean(token) && !pendienteApertura && !qrVencido

  // Formato mm:ss para la próxima renovación
  const segundosRestantes = Math.max(0, RENOVAR_CADA_SEGUNDOS - (edadSegundos ?? 0))
  const minutos = Math.floor(segundosRestantes / 60)
  const segundos = segundosRestantes % 60
  const tiempoFormateado = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
  const porcentajeTiempo = ((RENOVAR_CADA_SEGUNDOS - segundosRestantes) / RENOVAR_CADA_SEGUNDOS) * 100

  // Extraer host de la url del backend (qr_url) o del navegador si se accede por red
  const backendUrl = qrUrl || table?.qr_url || ''
  const hostBackend = extraerHostDeUrl(backendUrl)
  const defaultHost = obtenerHostPorDefecto(backendUrl)

  const [useWifiIp, setUseWifiIp] = useState(true)
  const [hostIp, setHostIp] = useState(defaultHost)
  const [prevHostBackend, setPrevHostBackend] = useState(hostBackend)

  if (hostBackend && hostBackend !== prevHostBackend) {
    setPrevHostBackend(hostBackend)
    setHostIp(hostBackend)
  }

  if (!table) return null

  // Decodificar atributos del token firmado
  const infoToken = decodificarTokenQr(token)
  const sid = infoToken.sid || (token ? token.slice(-8) : null)

  const defaultClientPort = (import.meta.env && import.meta.env.VITE_CLIENTE_PORT) || '5174'

  // El QR usa la url del backend y se regenera con hostIp manteniendo puerto y token
  const diningUrl = resolverDiningUrl({
    backendUrl,
    token,
    tableNumber: table.number || table.id,
    hostIp,
    useWifiIp,
    fallbackPort: defaultClientPort,
  })

  // Aviso cuando el QR apunta a localhost y no se podrá abrir desde celular
  const qrApuntaALocalhost = useWifiIp && esHostLocal(hostIp)

  // Tablet de la mesa (regresión v1.0.0, FALLO 1): la tablet no tiene la sesión
  // del personal. El panel le prepara la credencial de pantalla y el QR vigente
  // (solo si la mesa está ocupada) y se los pasa en el # de
  // /pantalla/mesa/<id_mesa> (services/qrService.js, prepararTabletDesdePanel).
  const prepararEnlace = () => prepararTabletDesdePanel(tableId, window.location.origin)

  const lanzarPantalla = async () => {
    if (preparandoTablet) return
    // La pestaña se abre YA, dentro del clic (si no, el navegador la bloquea);
    // el enlace con la credencial llega cuando esté listo.
    const ventana = window.open('', '_blank')
    setErrorTablet('')
    setPreparandoTablet(true)
    try {
      const { enlace } = await prepararEnlace()
      if (ventana) {
        // La pestaña abierta desde el panel hereda una COPIA de su sessionStorage
        // (la sesión del personal). La tablet no debe tenerla: se vacía antes
        // de cargar la pantalla (es del mismo origen, about:blank).
        try {
          ventana.sessionStorage.clear()
        } catch {
          // otro origen o sin almacenamiento: no hay nada copiado
        }
        ventana.opener = null
        ventana.location.replace(enlace)
      } else {
        window.open(enlace, '_blank', 'noopener')
      }
    } catch (err) {
      ventana?.close()
      setErrorTablet(err?.message || 'No se pudo preparar la pantalla de la mesa')
    } finally {
      setPreparandoTablet(false)
    }
  }

  const copiarUrlTablet = async () => {
    if (preparandoTablet) return
    setErrorTablet('')
    setPreparandoTablet(true)
    try {
      const { enlace } = await prepararEnlace()
      await navigator.clipboard.writeText(enlace)
      setCopiedTablet(true)
      setTimeout(() => setCopiedTablet(false), 2000)
    } catch (err) {
      setErrorTablet(err?.message || 'No se pudo copiar el enlace de la pantalla')
    } finally {
      setPreparandoTablet(false)
    }
  }

  const handleCopy = () => {
    // Un enlace vencido o que todavía no se renovó no se copia.
    if (!diningUrl || !qrVigente) return
    navigator.clipboard.writeText(diningUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Apertura de mesa desde el modal (generación del QR dinámico de sesión)
  const handleAbrirMesa = async () => {
    if (!onOpenTable) return
    setLoadingAction(true)
    try {
      const res = await onOpenTable(table.id || table.number)
      if (res?.token) {
        setToken(res.token)
        if (res?.url) {
          setQrUrl(res.url)
        }
        // Recién abierta con /abrir: el token es nuevo, no hace falta rotarlo.
        pidioAlAbrir.current = true
        marcarRenovado()
      }
    } finally {
      setLoadingAction(false)
    }
  }

  // Liberación manual de la mesa
  const handleLiberarMesa = async () => {
    if (!onFreeTable) return
    if (!window.confirm(`¿Liberar ${table.name}? El QR actual dejará de funcionar de inmediato.`)) {
      return
    }
    setLoadingAction(true)
    try {
      await onFreeTable(table.id || table.number)
      onClose()
    } finally {
      setLoadingAction(false)
    }
  }

  const handleDownload = () => {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `QR_Sesion_Mesa_${table.number || table.id}_SmartDining.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="tema-comanda qm-fondo" onClick={onClose}>
      <div className="qm-tarjeta" onClick={(e) => e.stopPropagation()}>
        <div className="qm-franja" aria-hidden="true" />
        <div className="qm-cabecera">
          <div className="qm-cabecera-izq">
            <div className="qm-icono">
              <QrCode size={20} />
            </div>
            <div className="qm-titulos">
              <span aria-hidden="true" className="qm-kicker">Código QR</span>
              <h3 className="qm-titulo">QR · MESA {table.number || table.id}</h3>
              <span aria-hidden="true" className={`qm-estado ${isOcupada ? 'ocupada' : isDisponible ? 'disponible' : 'cuenta_pedida'}`}>
                {isOcupada ? 'OCUPADA' : isDisponible ? 'DISPONIBLE' : (table.status || 'ESTADO').toUpperCase()}
              </span>
              <p className="qm-subtitulo">
                {table.location || 'Salón'} · Capacidad: {table.seats || table.capacidad || 4} personas
              </p>
            </div>
          </div>
          <button className="qm-cerrar" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="qm-cuerpo">
          {/* Tarjeta del Código QR en Pantalla para el Comensal */}
          <div className="qm-impreso" ref={qrRef}>
            <div className="qm-impreso-marca">
              <div className="qm-marca">
                <span className="qm-marca-sd">
                  SD
                </span>
                <span className="qm-marca-nombre">
                  SMARTDINING
                </span>
              </div>
              <span className="qm-impreso-mesa">MESA {table.number || table.id}</span>
            </div>

            <div
              className={`qm-qr ${justRotated ? 'qm-qr-renovado' : ''}`}
            >
              {token && pendienteApertura ? (
                <div className="qm-qr-vacio" role="status">
                  <RefreshCw size={40} className="spin qm-vacio-icono" />
                  <p className="qm-vacio-texto">Generando QR vigente…</p>
                </div>
              ) : token && qrVencido ? (
                <div className="qm-qr-vacio" role="alert">
                  <AlertCircle size={44} className="qm-vacio-icono qm-vacio-icono-alerta" />
                  <p className="qm-vacio-titulo">QR vencido</p>
                  <p className="qm-vacio-texto">
                    {errorRotacion || 'El código rota cada 3 minutos mientras la mesa esté vacía; este ya no sirve.'}
                  </p>
                  <button
                    type="button"
                    className="qm-btn qm-btn-ambar"
                    onClick={() => ejecutarRotacion('manual')}
                    disabled={loadingAction}
                  >
                    <RefreshCw size={14} className={loadingAction ? 'spin' : ''} />
                    <span>{loadingAction ? 'Generando...' : 'Generar nuevo'}</span>
                  </button>
                </div>
              ) : token ? (
                <QRCodeSVG
                  value={diningUrl}
                  size={210}
                  level="H"
                  includeMargin={true}
                  fgColor="#120E0D"
                  bgColor="#ffffff"
                />
              ) : isOcupada ? (
                <div className="qm-qr-vacio">
                  <QrCode size={48} className="qm-vacio-icono" />
                  <p className="qm-vacio-texto">
                    Esta mesa tiene una sesión abierta, pero su QR no está en este dispositivo.
                  </p>
                  <button
                    type="button"
                    className="qm-btn qm-btn-ambar"
                    onClick={() => ejecutarRotacion('manual')}
                    disabled={loadingAction || tieneComensalesOpedidos}
                    title={tieneComensalesOpedidos ? 'La mesa ya tiene comensales: rotar el QR los sacaría de la mesa' : undefined}
                  >
                    <RefreshCw size={14} className={loadingAction ? 'spin' : ''} />
                    <span>{loadingAction ? 'Generando...' : 'Generar nuevo QR'}</span>
                  </button>
                  <p className="qm-vacio-nota">
                    El QR anterior dejará de funcionar.
                  </p>
                </div>
              ) : (
                <div className="qm-qr-vacio">
                  <QrCode size={56} className="qm-vacio-icono" />
                  <p className="qm-vacio-texto">Mesa disponible. Pulsa "Abrir Mesa" para generar el QR de la sesión.</p>
                </div>
              )}

              {justRotated && (
                <div className="qm-qr-aviso">
                  <Sparkles size={18} className="qm-qr-aviso-icono" />
                  ¡QR Renovado!
                </div>
              )}
            </div>

            <div className="qm-impreso-pie">
              {token ? (
                <>
                  <p className="qm-impreso-cta">
                    Muestra este código al grupo. Válido durante su estadía.
                  </p>
                  <div className="qm-firma">
                    <ShieldCheck size={12} />
                    <span>v1 firmado · sid: {sid || 'activo'}</span>
                  </div>
                </>
              ) : (
                <p className="qm-impreso-cta qm-impreso-sin">Sin sesión activa</p>
              )}
            </div>
          </div>

          {/* Controles de Sesión y Ajustes para el Personal */}
          <div className="qm-controles">
            {/* Estado actual de la mesa */}
            <div className="qm-estado-fila">
              <span className="qm-rotulo">Estado de la mesa:</span>
              <span className={`qm-estado ${isOcupada ? 'ocupada' : isDisponible ? 'disponible' : 'cuenta_pedida'}`}>
                {isOcupada ? 'OCUPADA' : isDisponible ? 'DISPONIBLE' : (table.status || 'ESTADO').toUpperCase()}
              </span>
            </div>

            {/* SECCIÓN P-07: Rotación y Temporizador de 3 Minutos */}
            {isOcupada && token && (
              <div className="qm-tiquete qm-rotacion">
                <div className="qm-rotacion-cabeza">
                  <div className="qm-rotacion-titulo">
                    <Clock
                      size={16}
                      className="qm-icono-ambar"
                    />
                    <strong className="qm-rotacion-nombre">
                      Rotación Automática (3 min)
                    </strong>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAutoRotacionHabilitada((prev) => !prev)}
                    disabled={tieneComensalesOpedidos}
                    title={
                      tieneComensalesOpedidos
                        ? 'La mesa ya tiene comensales: el QR queda fijo'
                        : autoRotacionHabilitada ? 'Pausar auto-rotación' : 'Activar auto-rotación'
                    }
                    className={autoRotacionHabilitada ? 'qm-pausa' : 'qm-pausa qm-pausa-inactiva'}
                  >
                    {autoRotacionHabilitada ? <Pause size={14} /> : <Play size={14} />}
                    <span>{autoRotacionHabilitada ? 'Pausar' : 'Reanudar'}</span>
                  </button>
                </div>

                {/* Barra de progreso de los 3 minutos */}
                <div className="qm-barra">
                  <div
                    className={
                      tieneComensalesOpedidos
                        ? 'qm-barra-relleno qm-barra-fija'
                        : segundosRestantes <= 30
                          ? 'qm-barra-relleno qm-barra-urgente'
                          : 'qm-barra-relleno'
                    }
                    style={{
                      width: tieneComensalesOpedidos ? '100%' : `${porcentajeTiempo}%`,
                    }}
                  />
                </div>

                {/* Info del temporizador y Botón Nuevo QR */}
                <div className="qm-rotacion-pie">
                  <div className="qm-rotacion-info">
                    {tieneComensalesOpedidos ? (
                      <span className="qm-rotacion-pausa">
                        <span>⏸️ En pausa:</span>
                        <strong>comensales en mesa</strong>
                      </span>
                    ) : autoRotacionHabilitada ? (
                      <span>
                        Próxima renovación en:{' '}
                        <strong className="qm-reloj">
                          {tiempoFormateado}
                        </strong>
                      </span>
                    ) : (
                      <span className="qm-rotacion-manual">Auto-rotación pausada manualmente</span>
                    )}
                  </div>

                  {/* Botón Nuevo QR oficial de P-07. Con comensales no se rota:
                      invalidaría la sesión de quien ya entró. */}
                  <button
                    type="button"
                    onClick={() => ejecutarRotacion('manual')}
                    disabled={loadingAction || tieneComensalesOpedidos}
                    className="qm-btn qm-btn-mini"
                    title={
                      tieneComensalesOpedidos
                        ? 'La mesa ya tiene comensales: el QR queda fijo'
                        : 'Rotar inmediatamente el QR de la mesa (POST /api/mesas/:id/rotar-qr)'
                    }
                  >
                    <RefreshCw size={13} className={loadingAction ? 'spin' : ''} />
                    <span>{loadingAction ? 'Rotando...' : 'Nuevo QR'}</span>
                  </button>
                </div>

                <div className="qm-rotacion-nota">
                  {tieneComensalesOpedidos
                    ? '🔒 La mesa ya tiene comensales: el QR queda fijo y nadie pierde su sesión. Si este enlace no sirve, usa el QR de la pantalla de la mesa.'
                    : '🛡️ Seguridad: El código rota cada 3 min mientras no haya comensales para invalidar fotos o capturas viejas.'}
                </div>

                {errorRotacion && !qrVencido && (
                  <div role="alert" className="qm-error">
                    {errorRotacion}
                  </div>
                )}
              </div>
            )}

            {/* Metadatos de la sesión activa */}
            {isOcupada && token && (
              <div className="qm-tiquete qm-sesion">
                <div className="qm-sesion-dato">
                  <span className="qm-sesion-rotulo">ID Sesión (sid):</span>
                  <strong className="qm-sesion-sid">{sid}</strong>
                </div>
                <div className="qm-sesion-dato">
                  <span className="qm-sesion-rotulo">
                    <Clock size={12} className="qm-icono-linea" /> Expiración estimada:
                  </span>
                  <span>{infoToken.expiraTexto || '4 horas tras apertura'}</span>
                </div>
                <small className="qm-sesion-nota">
                  🔒 El backend rechaza peticiones con 401 si el sid no coincide con esta mesa.
                </small>
              </div>
            )}

            {/* Acción de Apertura si la mesa está libre */}
            {isDisponible && (
              <div className="qm-abrir">
                <p className="qm-abrir-texto">
                  Genera un QR nuevo e inicia la sesión para el grupo que va a ocupar esta mesa.
                </p>
                <button
                  type="button"
                  className="qm-btn qm-btn-ambar qm-btn-ancho"
                  onClick={handleAbrirMesa}
                  disabled={loadingAction}
                >
                  <Sparkles size={16} />
                  <span>{loadingAction ? 'Generando QR...' : 'Abrir Mesa y Generar QR'}</span>
                </button>
              </div>
            )}

            {/* Modo Pantalla Tablet (QR en Vidrio) */}
            <div className="qm-tablet">
              <div className="qm-tablet-izq">
                <div className="qm-tablet-icono">
                  <Tablet size={20} />
                </div>
                <div className="qm-tablet-textos">
                  <h4 className="qm-tablet-titulo">Modo Pantalla Tablet ("QR en Vidrio")</h4>
                  <p className="qm-tablet-desc">
                    Vista para la tablet fija de la mesa. Se conecta al socket server y se auto-refresca sola cuando el token rota.
                  </p>
                </div>
              </div>
              <div className="qm-tablet-botones">
                <button
                  type="button"
                  onClick={lanzarPantalla}
                  disabled={preparandoTablet}
                  className="qm-btn qm-btn-ambar"
                  title="Abrir la interfaz dedicada para la tablet física de la mesa"
                >
                  <Monitor size={14} />
                  <span>Lanzar Pantalla</span>
                </button>
                <button
                  type="button"
                  className={`qm-btn qm-btn-oscuro ${copiedTablet ? 'copied' : ''}`}
                  onClick={copiarUrlTablet}
                  disabled={preparandoTablet}
                  title="Copiar URL para configurar la tablet del restaurante (lleva su credencial: compártela solo con la tablet)"
                >
                  {copiedTablet ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedTablet ? 'Copiada' : 'Copiar URL Tablet'}</span>
                </button>
              </div>
              {errorTablet && (
                <p role="alert" className="qm-tablet-error">
                  {errorTablet}
                </p>
              )}
            </div>

            {/* Selector de Conexión Wi-Fi vs Local */}
            {token && (
              <div className="qm-tiquete qm-red">
                <div className="qm-red-cabeza">
                  <span className="qm-rotulo">
                    <Wifi size={14} className="qm-icono-linea" /> Destino del Escaneo:
                  </span>
                  <div className="qm-red-opciones">
                    <button
                      type="button"
                      className={`qm-opcion ${useWifiIp ? 'active' : ''}`}
                      onClick={() => setUseWifiIp(true)}
                    >
                      <Smartphone size={13} />
                      <span>Wi-Fi (Móviles)</span>
                    </button>
                    <button
                      type="button"
                      className={`qm-opcion ${!useWifiIp ? 'active' : ''}`}
                      onClick={() => setUseWifiIp(false)}
                    >
                      <span>Localhost</span>
                    </button>
                  </div>
                </div>

                {useWifiIp && (
                  <div className="qm-ip">
                    <label className="qm-ip-label">IP del servidor en tu Wi-Fi:</label>
                    <input
                      type="text"
                      value={hostIp}
                      onChange={(e) => setHostIp(e.target.value.trim())}
                      placeholder="192.168.1.X"
                      className="qm-input"
                    />
                    {qrApuntaALocalhost && (
                      <div className="qm-aviso-local">
                        <AlertCircle size={15} className="qm-aviso-local-icono" />
                        <span>
                          El QR apunta a localhost: un celular no podrá abrirlo. Escribe la IP de este PC en la red Wi-Fi.
                        </span>
                      </div>
                    )}
                    <small className="qm-ip-nota">
                      💡 Los comensales deben estar conectados al mismo Wi-Fi del restaurante.
                    </small>
                  </div>
                )}
              </div>
            )}

            {/* Enlace directo codificado en el QR */}
            {token && (
              <div className="qm-enlace">
                <label className="qm-rotulo">
                  Enlace codificado en el QR:
                </label>
                <div className="qm-enlace-grupo">
                  <input
                    type="text"
                    readOnly
                    value={qrVigente ? diningUrl : ''}
                    placeholder={pendienteApertura ? 'Generando QR vigente…' : 'QR vencido: genera uno nuevo'}
                    aria-label="Enlace del comensal"
                    className="qm-input qm-enlace-input"
                  />
                  <button
                    type="button"
                    className={`qm-btn qm-enlace-copiar ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                    disabled={!qrVigente}
                    title="Copiar enlace"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copied ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Botones de Acción para el Mesero */}
            <div className="qm-acciones">
              {isOcupada && onFreeTable && (
                <button
                  type="button"
                  className="qm-btn qm-btn-liberar"
                  onClick={handleLiberarMesa}
                  disabled={loadingAction}
                  title="Libera la mesa manualmente e invalida el QR actual"
                >
                  <LogOut size={16} />
                  <span>Liberar Mesa</span>
                </button>
              )}

              {token && (
                <button
                  type="button"
                  className="qm-btn qm-accion"
                  onClick={() => ejecutarRotacion('manual')}
                  disabled={loadingAction || tieneComensalesOpedidos}
                  title={
                    tieneComensalesOpedidos
                      ? 'La mesa ya tiene comensales: el QR queda fijo'
                      : 'Rotar el QR con POST /api/mesas/:id/rotar-qr'
                  }
                >
                  <RotateCw size={16} className={loadingAction ? 'spin' : ''} />
                  <span>Rotar QR</span>
                </button>
              )}

              {token && (
                <button
                  type="button"
                  className="qm-btn qm-accion"
                  onClick={handleDownload}
                >
                  <Download size={16} />
                  <span>Guardar SVG</span>
                </button>
              )}

              {token && (
                <button
                  type="button"
                  className="qm-btn qm-accion"
                  onClick={handlePrint}
                >
                  <Printer size={16} />
                  <span>Imprimir</span>
                </button>
              )}

              {token && (
                <button
                  type="button"
                  onClick={lanzarPantalla}
                  disabled={preparandoTablet}
                  className="qm-btn qm-accion"
                  title="Abrir vista de tablet para esta mesa"
                >
                  <Tablet size={16} />
                  <span>Pantalla Tablet</span>
                </button>
              )}

              {token && (
                <a
                  href={diningUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="qm-btn qm-accion"
                >
                  <ExternalLink size={16} />
                  <span>Probar comensal</span>
                </a>
              )}
            </div>
            {isOcupada && onFreeTable && (
              <span aria-hidden="true" className="qm-liberar-nota">Cierra la sesión de los comensales.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
