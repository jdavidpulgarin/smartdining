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
    <div className="min-h-screen bg-crema text-cafe flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center shadow-xl space-y-6">
        <div className="text-2xl font-black font-titulo text-primary tracking-tight">
          Smart<span className="text-cafe">Dining</span>
        </div>

        <div
          aria-hidden="true"
          className="w-16 h-16 bg-verde text-white rounded-full flex items-center justify-center mx-auto text-3xl font-bold shadow-sm"
        >
          ✓
        </div>

        <div className="space-y-2">
          <h1 className="font-titulo text-2xl font-bold text-cafe">
            ¡Gracias por tu visita!
          </h1>
          <p className="text-sm text-cafe leading-relaxed">{mensaje}</p>
        </div>
      </Card>
    </div>
  );
}

export default Despedida;
