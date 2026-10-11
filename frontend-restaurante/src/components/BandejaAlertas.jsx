import { useState, useCallback } from 'react'
import {
  Bell,
  BellRing,
  X,
  CheckCircle2,
  Trash2,
  Volume2,
  VolumeX,
  Clock,
  Utensils,
  Receipt,
  UserCheck,
  CreditCard,
} from 'lucide-react'

export function BandejaAlertas({
  alertas = [],
  onAtender,
  onLimpiarTodas,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [sonidoHabilitado, setSonidoHabilitado] = useState(true)

  const pendientes = alertas.filter((a) => !a.atendida)
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
        return <UserCheck size={16} className="text-amber" />
      case 'cuenta':
        return <Receipt size={16} className="text-emerald" />
      case 'pedido_listo':
        return <Utensils size={16} className="text-emerald" />
      case 'pago':
        return <CreditCard size={16} className="text-emerald" />
      default:
        return <BellRing size={16} className="text-amber" />
    }
  }

  return (
    <div className="bandeja-alertas-wrapper" style={{ position: 'relative' }}>
      {/* Botón Disparador de Alertas */}
      <button
        type="button"
        className={`alertas-trigger-btn ${countPendientes > 0 ? 'has-alerts' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Bandeja de llamadas de mesas y avisos de cocina"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          background: countPendientes > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
          border: countPendientes > 0 ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
          color: countPendientes > 0 ? '#fbbf24' : '#cbd5e1',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
      >
        {countPendientes > 0 ? (
          <BellRing size={18} className="bell-shake" />
        ) : (
          <Bell size={18} />
        )}

        {countPendientes > 0 && (
          <span
            className="alertas-badge-counter"
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              background: '#ef4444',
              color: '#ffffff',
              fontSize: '0.68rem',
              fontWeight: 700,
              minWidth: '18px',
              height: '18px',
              padding: '0 4px',
              borderRadius: '999px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
            }}
          >
            {countPendientes}
          </span>
        )}
      </button>

      {/* Menú Desplegable Flotante */}
      {isOpen && (
        <>
          {/* Backdrop para cerrar al hacer clic afuera */}
          <div
            className="alertas-dropdown-backdrop"
            onClick={() => setIsOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 90 }}
          />

          <div
            className="alertas-dropdown-panel"
            style={{
              position: 'absolute',
              top: '46px',
              right: 0,
              width: '360px',
              maxWidth: '90vw',
              background: 'rgba(15, 23, 42, 0.96)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '14px',
              boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.7)',
              zIndex: 100,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Cabecera del Panel */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bell size={16} className="text-emerald" />
                <strong style={{ fontSize: '0.9rem', color: '#f8fafc' }}>
                  Alertas de Sala
                </strong>
                {countPendientes > 0 && (
                  <span
                    style={{
                      background: 'rgba(245, 158, 11, 0.2)',
                      color: '#fbbf24',
                      fontSize: '0.7rem',
                      padding: '2px 6px',
                      borderRadius: '6px',
                    }}
                  >
                    {countPendientes} activas
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setSonidoHabilitado((prev) => !prev)}
                  title={sonidoHabilitado ? 'Silenciar alertas' : 'Activar sonido'}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: sonidoHabilitado ? 'var(--emerald-400, #34d399)' : '#64748b',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  {sonidoHabilitado ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>

                {alertas.length > 0 && onLimpiarTodas && (
                  <button
                    type="button"
                    onClick={onLimpiarTodas}
                    title="Limpiar todas las alertas"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '4px',
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Lista de Alertas */}
            <div
              style={{
                maxHeight: '340px',
                overflowY: 'auto',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {pendientes.length > 0 ? (
                pendientes.map((alerta) => (
                  <div
                    key={alerta.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background:
                        alerta.tipo === 'llamado'
                          ? 'rgba(245, 158, 11, 0.08)'
                          : alerta.tipo === 'cuenta'
                          ? 'rgba(59, 130, 246, 0.08)'
                          : 'rgba(16, 185, 129, 0.08)',
                      border:
                        alerta.tipo === 'llamado'
                          ? '1px solid rgba(245, 158, 11, 0.25)'
                          : alerta.tipo === 'cuenta'
                          ? '1px solid rgba(59, 130, 246, 0.25)'
                          : '1px solid rgba(16, 185, 129, 0.25)',
                    }}
                  >
                    <div style={{ marginTop: '2px' }}>{getAlertaIcon(alerta.tipo)}</div>

                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '2px',
                        }}
                      >
                        <strong style={{ fontSize: '0.82rem', color: '#f1f5f9' }}>
                          Mesa {alerta.idMesa || alerta.mesa}
                        </strong>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            color: 'var(--text-muted, #94a3b8)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <Clock size={10} />
                          {alerta.hora || 'Ahora'}
                        </span>
                      </div>

                      <p
                        style={{
                          fontSize: '0.78rem',
                          color: '#cbd5e1',
                          margin: '2px 0 6px 0',
                          lineHeight: '1.25',
                        }}
                      >
                        {alerta.mensaje}
                      </p>

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => handleAtender(alerta.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: 'rgba(16, 185, 129, 0.2)',
                            color: 'var(--emerald-300, #6ee7b7)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <CheckCircle2 size={12} />
                          <span>Atendida</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '24px 16px',
                    color: 'var(--text-muted, #94a3b8)',
                    fontSize: '0.82rem',
                  }}
                >
                  <CheckCircle2
                    size={28}
                    className="text-emerald"
                    style={{ margin: '0 auto 8px auto', display: 'block', opacity: 0.6 }}
                  />
                  <span>Sin llamados ni alertas pendientes en sala</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
