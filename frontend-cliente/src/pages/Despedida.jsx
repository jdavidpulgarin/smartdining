import { useLocation, useNavigate } from 'react-router-dom';
import { useSesion } from '../context/SesionContext';
import Card from '../components/ui/Card';

function Despedida() {
  const location = useLocation();
  const navigate = useNavigate();
  const { motivoCierre, sesion } = useSesion();
  const motivo = location.state?.motivo ?? motivoCierre;
  const numeroMesa =
    location.state?.numeroMesa ??
    sesion?.numeroMesa ??
    sesion?.idMesa ??
    null;

  const textoMesa = numeroMesa
    ? `La cuenta de la mesa ${numeroMesa} quedó pagada.`
    : 'La cuenta de la mesa quedó pagada.';

  return (
    <div className="min-h-screen bg-fondo text-texto flex items-center justify-center p-4">
      {motivo === 'pagada' ? (
        <section
          className="entra max-w-md w-full"
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: '#161616',
            border: '1px solid #2A2A2A',
            borderRadius: '24px',
            padding: '28px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            textAlign: 'center',
          }}
        >
          <svg
            className="ilu"
            width="240"
            height="190"
            viewBox="0 0 240 190"
            aria-hidden="true"
          >
            <rect className="confeti" x="30" y="0" width="8" height="12" rx="2" fill="#E3242B" />
            <rect className="confeti f2" x="70" y="0" width="8" height="12" rx="2" fill="#F2B705" />
            <rect className="confeti f3" x="170" y="0" width="8" height="12" rx="2" fill="#2FA35A" />
            <rect className="confeti f4" x="205" y="0" width="8" height="12" rx="2" fill="#FF5A5F" />
            <rect className="confeti f5" x="120" y="0" width="8" height="12" rx="2" fill="#F2B705" />
            <rect className="confeti f6" x="95" y="0" width="8" height="12" rx="2" fill="#2FA35A" />
            <g className="late">
              <path
                d="M120 150 C70 115 60 85 80 66 C96 52 114 58 120 72 C126 58 144 52 160 66 C180 85 170 115 120 150 Z"
                fill="#E3242B"
              />
              <path
                d="M92 76 A16 16 0 0 1 104 66"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="5"
                strokeLinecap="round"
                opacity=".6"
              />
            </g>
          </svg>
          <h1
            style={{
              margin: 0,
              fontFamily: "'Bebas Neue', sans-serif",
              fontWeight: 400,
              fontSize: '52px',
              lineHeight: 0.95,
              letterSpacing: '1px',
              color: '#FF5A5F',
            }}
          >
            ¡GRACIAS POR VENIR!
          </h1>
          <p style={{ margin: 0, fontSize: '15px' }}>{textoMesa}</p>
          <p style={{ margin: 0, fontSize: '13px', color: '#A3A3A3' }}>
            Para volver a pedir, escanea el QR de la mesa otra vez.
          </p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="btn-despedida-inicio"
          >
            Volver al inicio
          </button>
        </section>
      ) : (
        <Card className="max-w-md w-full p-8 text-center shadow-2xl space-y-6 bg-superficie border border-borde rounded-2xl">
          <div className="text-2xl font-black font-titulo text-primario tracking-tight">
            Smart<span className="text-texto">Dining</span>
          </div>

          <div
            aria-hidden="true"
            className="w-16 h-16 bg-exito text-white rounded-full flex items-center justify-center mx-auto text-3xl font-bold shadow-md"
          >
            ✓
          </div>

          <div className="space-y-2">
            <h1 className="font-titulo text-3xl font-bold text-texto uppercase tracking-wider">
              ¡Gracias por tu visita!
            </h1>
            <p className="text-sm text-texto-suave leading-relaxed">
              La mesa se cerró. Si quieres pedir de nuevo, escanea el QR de la mesa.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="btn-despedida-inicio"
          >
            Volver al inicio
          </button>
        </Card>
      )}
    </div>
  );
}

export default Despedida;
