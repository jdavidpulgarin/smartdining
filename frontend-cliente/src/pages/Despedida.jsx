import { useLocation } from 'react-router-dom';
import { useSesion } from '../context/SesionContext';
import Card from '../components/ui/Card';

function Despedida() {
  const location = useLocation();
  const { motivoCierre } = useSesion();
  const motivo = location.state?.motivo ?? motivoCierre;

  const mensaje =
    motivo === 'pagada'
      ? 'Tu cuenta quedó pagada. Esperamos verte pronto.'
      : 'La mesa se cerró. Si quieres pedir de nuevo, escanea el QR de la mesa.';

  return (
    <div className="min-h-screen bg-fondo text-texto flex items-center justify-center p-4">
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
          <p className="text-sm text-texto-suave leading-relaxed">{mensaje}</p>
        </div>
      </Card>
    </div>
  );
}

export default Despedida;
