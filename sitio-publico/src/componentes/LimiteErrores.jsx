import React from 'react';
import restaurante from '../datos/restaurante.js';
import Button from '../components/ui/Button.jsx';

/**
 * Límite de errores (ErrorBoundary) para evitar pantallas negras ante excepciones no controladas.
 * Muestra el logo, nombre, mensaje de disculpa, botón de recarga e información de contacto fija.
 */
export class LimiteErrores extends React.Component {
  constructor(props) {
    super(props);
    this.state = { tieneError: Boolean(props.forzarError) };
  }

  static getDerivedStateFromError() {
    return { tieneError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error no controlado en la aplicación:', error, errorInfo);
  }

  render() {
    if (this.state.tieneError) {
      const nombre = restaurante.nombre || 'SmartDining';
      const direccionTexto = [
        restaurante.direccion?.calle,
        restaurante.direccion?.ciudad,
      ]
        .filter(Boolean)
        .join(', ');

      return (
        <div
          role="alert"
          className="min-h-screen bg-fondo text-texto font-cuerpo flex flex-col items-center justify-center p-6 text-center select-none"
        >
          <div className="max-w-md w-full bg-superficie rounded-3xl border border-borde p-8 sm:p-10 shadow-2xl space-y-6">
            <img
              src="/logo.png"
              alt={nombre}
              width={120}
              height={120}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl mx-auto object-cover bg-superficie-2 border border-borde p-1 shadow-lg"
            />

            <div className="space-y-2">
              <h1 className="font-titulo text-3xl sm:text-4xl uppercase tracking-wider text-texto leading-none">
                {nombre}
              </h1>
              <p className="text-base text-texto-suave font-cuerpo leading-relaxed">
                Tuvimos un problema al cargar la página.
              </p>
            </div>

            <div>
              <Button
                type="button"
                variante="primario"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.location) {
                    window.location.reload();
                  }
                }}
              >
                Recargar
              </Button>
            </div>

            {/* Datos de contacto fijos de respaldo */}
            <div className="pt-6 border-t border-borde/70 space-y-2 text-xs sm:text-sm text-texto-suave">
              {direccionTexto && (
                <p className="font-cuerpo">{direccionTexto}</p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                {restaurante.telefono && restaurante.telefonoVisible && (
                  <a
                    href={`tel:${restaurante.telefono}`}
                    className="hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                  >
                    Tel: {restaurante.telefonoVisible}
                  </a>
                )}
                {restaurante.whatsapp && restaurante.whatsappVisible && (
                  <a
                    href={`https://wa.me/${restaurante.whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                  >
                    WhatsApp: {restaurante.whatsappVisible}
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default LimiteErrores;
