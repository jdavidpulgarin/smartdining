import { useState, useCallback, useMemo } from 'react'
import {
  Bell,
  BellRing,
  X,
  CheckCircle2,
  Trash2,
  Volume2,
  VolumeX,
  Utensils,
  Receipt,
  UserCheck,
  CreditCard,
} from 'lucide-react'

export function BandejaAlertas({
  alertas = [],
  onAtender,
  onLimpiarTodas,
  compact = false,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [sonidoHabilitado, setSonidoHabilitado] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState('todos')

  const pendientes = useMemo(() => {
    return (alertas || []).filter((a) => !a.atendida)
  }, [alertas])

  const countPendientes = pendientes.length

  const handleAtender = useCallback(
    (id) => {
      if (onAtender) onAtender(id)
    },
    [onAtender]
  )

  const getAlertaIcon = (tipo) => {
    switch (tipo) {
      case 'llamado':
        return <UserCheck size={16} />
      case 'cuenta':
        return <Receipt size={16} />
      case 'pedido_listo':
        return <Utensils size={16} />
      case 'pago':
        return <CreditCard size={16} />
      default:
        return <BellRing size={16} />
    }
  }

  const getDotClass = (tipo) => {
    switch (tipo) {
      case 'llamado':
        return 'sd-dot-red'
      case 'cuenta':
        return 'sd-dot-gold'
      case 'pedido_listo':
      case 'pago':
      default:
        return 'sd-dot-white'
    }
  }

  const getActionLabel = (tipo) => {
    if (tipo === 'pedido_listo') return 'MARCAR ENTREGADO'
    if (tipo === 'cuenta') return 'COBRAR / ATENDIDA'
    return 'ATENDIDA'
  }

  const alertasFiltradas = useMemo(() => {
    if (filtroTipo === 'llamados') return pendientes.filter((a) => a.tipo === 'llamado')
    if (filtroTipo === 'cuentas') return pendientes.filter((a) => a.tipo === 'cuenta')
    if (filtroTipo === 'pedidos') return pendientes.filter((a) => a.tipo === 'pedido_listo')
    return pendientes
  }, [pendientes, filtroTipo])

  // Modo Desplegable Flotante (para Topbar o barra superior)
  if (compact) {
    return (
      <div className="bandeja-alertas-wrapper" style={{ position: 'relative' }}>
        <button
          type="button"
          className="sd-topbar-bell-btn"
          onClick={() => setIsOpen((prev) => !prev)}
          title="Bandeja de llamadas de mesas y avisos de cocina"
          aria-label="Abrir bandeja de alertas"
        >
          {countPendientes > 0 ? (
            <BellRing size={20} className="bell-shake" style={{ color: 'var(--sd-red-text)' }} />
          ) : (
            <Bell size={20} />
          )}

          {countPendientes > 0 && (
            <span className="sd-topbar-bell-badge">
              {countPendientes}
            </span>
          )}
        </button>

        {isOpen && (
          <>
            <div
              className="alertas-dropdown-backdrop"
              onClick={() => setIsOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 90 }}
            />

            <div
              className="sd-card sd-alertas-panel"
              style={{
                position: 'absolute',
                top: '56px',
                right: 0,
                width: '380px',
                maxWidth: '90vw',
                zIndex: 100,
                boxShadow: '0 24px 48px rgba(0, 0, 0, 0.8)',
              }}
            >
              <div className="sd-alertas-header">
                <div className="sd-alertas-title-group">
                  <h3 className="sd-card-title" style={{ margin: 0, fontSize: 22 }}>ALERTAS</h3>
                  {countPendientes > 0 && (
                    <span className="sd-alertas-count">{countPendientes}</span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="sd-sound-toggle-btn"
                    onClick={() => setSonidoHabilitado((prev) => !prev)}
                    title={sonidoHabilitado ? 'Silenciar sonido' : 'Activar sonido'}
                  >
                    {sonidoHabilitado ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </button>
                  <button
                    type="button"
                    className="sd-sound-toggle-btn"
                    onClick={() => setIsOpen(false)}
                    title="Cerrar bandeja"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="sd-alertas-list" style={{ maxHeight: 380 }}>
                {pendientes.length > 0 ? (
                  pendientes.map((alerta) => (
                    <div key={alerta.id} className="sd-alerta-item">
                      <div className="sd-alerta-top">
                        <span className={`sd-alerta-dot ${getDotClass(alerta.tipo)}`} />
                        <strong className="sd-alerta-item-title">
                          MESA {alerta.idMesa || alerta.mesa} · {alerta.hora || 'Ahora'}
                        </strong>
                      </div>
                      <p className="sd-alerta-detail">{alerta.mensaje}</p>
                      <div className="sd-alerta-action">
                        <button
                          type="button"
                          className="sd-btn sd-btn-secondary"
                          style={{ minHeight: 30, fontSize: 12, padding: '3px 10px' }}
                          onClick={() => handleAtender(alerta.id)}
                        >
                          {getActionLabel(alerta.tipo)}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="sd-alertas-empty">
                    <CheckCircle2 size={32} />
                    <p>SIN ALERTAS ACTIVAS</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // Modo Tarjeta Lateral Fija (Diseño Oficial de Mesas)
  return (
    <aside className="sd-card sd-alertas-panel" aria-label="Bandeja de alertas activas">
      {/* Cabecera de Alertas */}
      <div className="sd-alertas-header">
        <div className="sd-alertas-title-group">
          <h2 className="sd-card-title" style={{ margin: 0 }}>ALERTAS</h2>
          {countPendientes > 0 && (
            <span className="sd-alertas-count">{countPendientes}</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {countPendientes > 0 && onLimpiarTodas && (
            <button
              type="button"
              className="sd-sound-toggle-btn"
              onClick={onLimpiarTodas}
              title="Limpiar todas las alertas atendidas"
              aria-label="Limpiar todas las alertas"
            >
              <Trash2 size={16} />
            </button>
          )}

          <button
            type="button"
            className="sd-sound-toggle-btn"
            onClick={() => setSonidoHabilitado((prev) => !prev)}
            title={sonidoHabilitado ? 'Silenciar alertas audibles' : 'Activar sonido de alertas'}
            aria-label={sonidoHabilitado ? 'Silenciar sonido' : 'Activar sonido'}
          >
            {sonidoHabilitado ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>
      </div>

      {/* Mini filtros rápidos si hay varias alertas */}
      {countPendientes > 2 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            paddingBottom: 8,
            borderBottom: '1px solid var(--sd-border)',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className={`sd-btn ${filtroTipo === 'todos' ? 'sd-btn-primary' : 'sd-btn-secondary'}`}
            style={{ minHeight: 28, fontSize: 11, padding: '2px 8px' }}
            onClick={() => setFiltroTipo('todos')}
          >
            TODAS ({countPendientes})
          </button>
          <button
            type="button"
            className={`sd-btn ${filtroTipo === 'llamados' ? 'sd-btn-primary' : 'sd-btn-secondary'}`}
            style={{ minHeight: 28, fontSize: 11, padding: '2px 8px' }}
            onClick={() => setFiltroTipo('llamados')}
          >
            LLAMADOS
          </button>
          <button
            type="button"
            className={`sd-btn ${filtroTipo === 'cuentas' ? 'sd-btn-primary' : 'sd-btn-secondary'}`}
            style={{ minHeight: 28, fontSize: 11, padding: '2px 8px' }}
            onClick={() => setFiltroTipo('cuentas')}
          >
            CUENTAS
          </button>
        </div>
      )}

      {/* Lista de Alertas en Sala */}
      <div className="sd-alertas-list">
        {alertasFiltradas.length > 0 ? (
          alertasFiltradas.map((alerta) => {
            const dotClass = getDotClass(alerta.tipo)
            const idMesa = alerta.idMesa || alerta.mesa || '?'
            const hora = alerta.hora || 'Ahora'
            const defaultMsg =
              alerta.tipo === 'llamado'
                ? 'Llamó al mesero a la mesa'
                : alerta.tipo === 'cuenta'
                ? 'Solicitó la cuenta'
                : 'Pedido listo para entregar'

            return (
              <div key={alerta.id} className="sd-alerta-item">
                <div className="sd-alerta-top">
                  <span className={`sd-alerta-dot ${dotClass}`} aria-hidden="true" />
                  <strong className="sd-alerta-item-title">
                    MESA {idMesa} · {hora}
                  </strong>
                  <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
                    {getAlertaIcon(alerta.tipo)}
                  </span>
                </div>

                <p className="sd-alerta-detail">
                  {alerta.mensaje || defaultMsg}
                </p>

                <div className="sd-alerta-action">
                  <button
                    type="button"
                    onClick={() => handleAtender(alerta.id)}
                    className="sd-btn sd-btn-secondary"
                    style={{ minHeight: 32, padding: '4px 14px', fontSize: 13 }}
                    aria-label={`Atender alerta de mesa ${idMesa}`}
                  >
                    <CheckCircle2 size={13} style={{ marginRight: 6 }} />
                    <span>{getActionLabel(alerta.tipo)}</span>
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="sd-alertas-empty">
            <CheckCircle2 size={36} aria-hidden="true" style={{ color: 'var(--sd-text-muted)', opacity: 0.8 }} />
            <p>SIN ALERTAS ACTIVAS</p>
            <small style={{ color: 'var(--sd-text-muted)' }}>
              El salón opera con normalidad sin avisos pendientes
            </small>
          </div>
        )}
      </div>
    </aside>
  )
}

