import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import { validarUrlQrMesa, clasificarErrorCamara, diagnosticarCamara } from '../utils/qr';
import { esDispositivoIos } from '../services/push';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

function EscanearQr() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const errorTimeoutRef = useRef(null);

  const [errorCamara, setErrorCamara] = useState(null);
  const [mensajeInvalido, setMensajeInvalido] = useState(null);

  const esIos =
    typeof navigator !== 'undefined'
      ? esDispositivoIos({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints,
        })
      : false;

  useEffect(() => {
    let activo = true;

    const iniciarEscaner = async () => {
      try {
        const diagnostico = await diagnosticarCamara();
        if (!activo) return;
        if (diagnostico !== 'ok') {
          setErrorCamara(clasificarErrorCamara(diagnostico));
          return;
        }

        const tieneCamara = await QrScanner.hasCamera();
        if (!activo) return;
        if (!tieneCamara) {
          setErrorCamara(clasificarErrorCamara('sin_camara'));
          return;
        }

        if (!videoRef.current) return;

        const scanner = new QrScanner(
          videoRef.current,
          (resultado) => {
            if (!activo) return;
            const texto =
              typeof resultado === 'string' ? resultado : resultado?.data;
            if (!texto) return;

            const origenActual =
              typeof window !== 'undefined' ? window.location.origin : '';
            const validacion = validarUrlQrMesa(texto, origenActual);

            if (validacion.ok && validacion.ruta) {
              if (scannerRef.current) {
                try {
                  scannerRef.current.destroy();
                } catch {
                  // Ignorar errores al destruir
                }
                scannerRef.current = null;
              }
              window.location.replace(validacion.ruta);
            } else {
              setMensajeInvalido('Este QR no es de SmartDining');
              if (errorTimeoutRef.current) {
                clearTimeout(errorTimeoutRef.current);
              }
              errorTimeoutRef.current = setTimeout(() => {
                if (activo) setMensajeInvalido(null);
              }, 3500);
            }
          },
          {
            preferredCamera: 'environment',
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 5,
          }
        );

        scannerRef.current = scanner;
        await scanner.start();
      } catch (err) {
        if (!activo) return;
        const mensajeStr = String(err?.message || err || '');
        if (mensajeStr.includes('Camera not found')) {
          setErrorCamara(clasificarErrorCamara('error_desconocido'));
        } else {
          setErrorCamara(clasificarErrorCamara(err));
        }
      }
    };

    iniciarEscaner();

    return () => {
      activo = false;
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
      if (scannerRef.current) {
        try {
          scannerRef.current.destroy();
        } catch {
          // Ignorar errores al destruir
        }
        scannerRef.current = null;
      }
    };
  }, [navigate]);

  return (
    <div className="relative min-h-screen bg-fondo text-texto flex flex-col justify-between overflow-hidden">
      {/* Barra superior */}
      <header className="relative z-20 flex items-center justify-between p-4 bg-fondo/80 backdrop-blur-md border-b border-borde">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg bg-primario flex items-center justify-center text-white font-etiqueta font-bold text-sm tracking-wider"
            aria-hidden="true"
          >
            SD
          </div>
          <span className="font-etiqueta font-bold text-sm text-white tracking-widest uppercase">
            ESCANEAR QR DE LA MESA
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-texto-suave hover:text-white text-sm font-semibold px-2 py-1 transition-colors"
          aria-label="Cerrar escáner y volver al inicio"
        >
          ✕
        </button>
      </header>

      {/* Área central: cámara o error */}
      <main className="relative flex-1 flex items-center justify-center p-4">
        {mensajeInvalido && (
          <div
            role="alert"
            aria-live="assertive"
            className="absolute top-6 left-4 right-4 z-30 max-w-sm mx-auto bg-superficie border border-primario text-primario-texto p-3.5 rounded-xl text-center text-sm font-bold shadow-2xl backdrop-blur-md"
          >
            {mensajeInvalido}
          </div>
        )}

        {errorCamara ? (
          <Card className="w-full max-w-sm p-6 text-center space-y-4 bg-superficie border border-borde rounded-2xl shadow-2xl">
            <div
              aria-hidden="true"
              className="w-14 h-14 bg-primario/15 text-primario-texto border border-primario/30 rounded-full flex items-center justify-center mx-auto text-2xl font-bold"
            >
              📷
            </div>
            <div className="space-y-2">
              <h1 className="font-titulo text-2xl text-white uppercase tracking-wide leading-tight">
                {errorCamara.mensaje}
              </h1>
              {errorCamara.tipo === 'permiso_denegado' ? (
                <p className="text-xs sm:text-sm text-texto-suave leading-relaxed">
                  Para escanear el código de tu mesa, activa el acceso a la cámara en los Ajustes de tu dispositivo o navegador.
                </p>
              ) : (
                <p className="text-xs sm:text-sm text-texto-suave leading-relaxed">
                  Asegúrate de que la cámara esté disponible y no esté siendo usada por otra aplicación.
                </p>
              )}
              <div className="pt-1 space-y-1">
                <p className="text-xs text-primario-texto font-semibold">
                  También puedes abrir el QR con la cámara de tu celular.
                </p>
                {esIos && (
                  <p className="text-xs text-texto-suave">
                    Si lo abres con la cámara del iPhone se abrirá Safari, y ahí no te llegarán los avisos de tu pedido.
                  </p>
                )}
              </div>
            </div>
            <Button
              type="button"
              variante="secundario"
              onClick={() => navigate('/')}
              className="w-full min-h-11 text-xs"
            >
              VOLVER AL INICIO
            </Button>
          </Card>
        ) : (
          <div className="relative w-full max-w-sm aspect-square rounded-2xl overflow-hidden border border-borde bg-black shadow-2xl flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            {/* Guía visual para centrar el QR */}
            <div className="absolute inset-8 pointer-events-none border-2 border-primario/70 rounded-xl" />
          </div>
        )}
      </main>

      {/* Barra inferior: Botón Cancelar */}
      <footer className="relative z-20 p-4 pb-6 bg-fondo/80 backdrop-blur-md border-t border-borde flex justify-center">
        <Button
          type="button"
          variante="secundario"
          onClick={() => navigate('/')}
          className="w-full max-w-sm min-h-12"
        >
          CANCELAR
        </Button>
      </footer>
    </div>
  );
}

export default EscanearQr;
