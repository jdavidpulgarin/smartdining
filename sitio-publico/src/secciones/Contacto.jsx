import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '../components/ui/Button.jsx';
import restauranteDefault from '../datos/restaurante.js';
import { estadoHorario } from '../utils/horario.js';

const DIAS_SEMANA = [
  { clave: 'lunes', etiqueta: 'Lunes' },
  { clave: 'martes', etiqueta: 'Martes' },
  { clave: 'miercoles', etiqueta: 'Miércoles' },
  { clave: 'jueves', etiqueta: 'Jueves' },
  { clave: 'viernes', etiqueta: 'Viernes' },
  { clave: 'sabado', etiqueta: 'Sábado' },
  { clave: 'domingo', etiqueta: 'Domingo' },
];

/**
 * Sección 'Contacto': dirección con address, mapa interactivo (fachada bajo demanda),
 * teléfono, WhatsApp con mensaje inicial, correo, horario completo y redes sociales.
 */
function Contacto({ datosRestaurante = {}, mapaVisibleInicial = false }) {
  const nombre = datosRestaurante.nombre || 'SmartDining Restaurante';
  const direccion = datosRestaurante.direccion;
  const horario = datosRestaurante.horario || restauranteDefault.horario;

  const [mapaVisible, setMapaVisible] = useState(() => Boolean(mapaVisibleInicial));
  const iframeRef = useRef(null);

  const [estado, setEstado] = useState(() => estadoHorario(new Date(), horario));

  useEffect(() => {
    setEstado(estadoHorario(new Date(), horario));
    const timer = setInterval(() => {
      setEstado(estadoHorario(new Date(), horario));
    }, 60000);
    return () => clearInterval(timer);
  }, [horario]);

  const activarMapa = () => {
    setMapaVisible(true);
  };

  useEffect(() => {
    if (mapaVisible && iframeRef.current) {
      iframeRef.current.focus();
    }
  }, [mapaVisible]);

  const direccionTexto = useMemo(() => {
    if (!direccion) return '';
    const partes = [direccion.calle, direccion.ciudad, direccion.region].filter(Boolean);
    return partes.join(', ');
  }, [direccion]);

  const queryMapa = useMemo(() => {
    const texto = [direccion?.calle, direccion?.ciudad].filter(Boolean).join(', ');
    return encodeURIComponent(texto || nombre);
  }, [direccion, nombre]);

  const urlWhatsapp = useMemo(() => {
    if (!datosRestaurante.whatsapp) return '';
    const mensaje = encodeURIComponent('Hola, quiero información');
    return `https://wa.me/${datosRestaurante.whatsapp}?text=${mensaje}`;
  }, [datosRestaurante.whatsapp]);

  return (
    <section
      id="contacto"
      aria-labelledby="titulo-contacto"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16 space-y-12"
    >
      <div className="space-y-2">
        <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
          Encuéntranos
        </span>
        <h2
          id="titulo-contacto"
          className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none"
        >
          Contacto
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Columna izquierda: Información, horario y canales */}
        <div className="space-y-6">
          {direccionTexto && (
            <div className="bg-superficie rounded-3xl border border-borde p-6 space-y-2 shadow-lg">
              <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                Ubicación
              </h3>
              <address className="not-italic text-base text-texto font-cuerpo leading-relaxed">
                {direccionTexto}
              </address>
            </div>
          )}

          {/* Teléfono, WhatsApp y Correo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {datosRestaurante.telefono && datosRestaurante.telefonoVisible && (
              <div className="bg-superficie rounded-2xl border border-borde p-5 space-y-1.5 shadow-sm">
                <h4 className="font-etiqueta uppercase tracking-wider text-xs font-bold text-acento">
                  Teléfono
                </h4>
                <p className="text-base text-texto font-cuerpo">
                  <a
                    href={`tel:${datosRestaurante.telefono}`}
                    className="min-h-11 inline-flex items-center hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                  >
                    {datosRestaurante.telefonoVisible}
                  </a>
                </p>
              </div>
            )}

            {urlWhatsapp && datosRestaurante.whatsappVisible && (
              <div className="bg-superficie rounded-2xl border border-borde p-5 space-y-1.5 shadow-sm">
                <h4 className="font-etiqueta uppercase tracking-wider text-xs font-bold text-acento">
                  WhatsApp
                </h4>
                <p className="text-base text-texto font-cuerpo">
                  <a
                    href={urlWhatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-11 inline-flex items-center hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                  >
                    {datosRestaurante.whatsappVisible}
                  </a>
                </p>
              </div>
            )}

            {datosRestaurante.correo && (
              <div className="bg-superficie rounded-2xl border border-borde p-5 space-y-1.5 shadow-sm sm:col-span-2">
                <h4 className="font-etiqueta uppercase tracking-wider text-xs font-bold text-acento">
                  Correo electrónico
                </h4>
                <p className="text-base text-texto font-cuerpo break-all">
                  <a
                    href={`mailto:${datosRestaurante.correo}`}
                    className="min-h-11 inline-flex items-center hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                  >
                    {datosRestaurante.correo}
                  </a>
                </p>
              </div>
            )}
          </div>

          {/* Horario de atención */}
          {(datosRestaurante.horarioVisible || horario) && (
            <div className="bg-superficie rounded-3xl border border-borde p-6 space-y-4 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                  Horario de atención
                </h3>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-superficie-2 border border-borde text-xs font-etiqueta font-semibold tracking-wider text-texto shrink-0">
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      estado.abierto ? 'bg-exito' : 'bg-texto-tenue'
                    }`}
                  />
                  <span>{estado.texto}</span>
                </span>
              </div>

              {datosRestaurante.horarioVisible && (
                <p className="text-base text-texto font-cuerpo font-medium">
                  {datosRestaurante.horarioVisible}
                </p>
              )}

              {horario && typeof horario === 'object' && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm pt-3 border-t border-borde/60">
                  {DIAS_SEMANA.map(({ clave, etiqueta }) => {
                    const dia = horario[clave];
                    const textoDia =
                      dia && dia.abre && dia.cierra
                        ? `${dia.abre} - ${dia.cierra}`
                        : 'Cerrado';
                    return (
                      <div
                        key={clave}
                        className="flex items-center justify-between py-1.5 border-b border-borde/40 last:border-b-0"
                      >
                        <dt className="font-semibold text-texto">{etiqueta}</dt>
                        <dd className="text-texto-suave font-etiqueta tracking-wide text-base">
                          {textoDia}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </div>
          )}

          {/* Redes sociales */}
          {Array.isArray(datosRestaurante.redes) && datosRestaurante.redes.length > 0 && (
            <div className="bg-superficie rounded-3xl border border-borde p-6 space-y-3 shadow-lg">
              <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                Redes sociales
              </h3>
              <ul className="flex flex-wrap gap-2.5">
                {datosRestaurante.redes.map((red) => (
                  <li key={red.url || red.nombre}>
                    <a
                      href={red.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${red.nombre} de ${nombre} (se abre en otra pestaña)`}
                      className="min-h-11 px-4 py-2 rounded-xl bg-superficie-2 border border-borde hover:border-acento text-sm font-etiqueta uppercase tracking-wider font-bold text-texto inline-flex items-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
                    >
                      <span>{red.nombre}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Columna derecha: Mapa interactivo (fachada con carga bajo demanda) */}
        <div className="bg-superficie rounded-3xl border border-borde p-6 space-y-4 shadow-lg sticky top-24">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
              Mapa
            </h3>
            <a
              href={`https://www.google.com/maps?q=${queryMapa}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-acento hover:underline font-semibold inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto rounded-lg"
            >
              Abrir en Google Maps ↗
            </a>
          </div>

          <div className="w-full h-72 sm:h-96 rounded-2xl overflow-hidden border border-borde bg-superficie-2">
            {mapaVisible ? (
              <iframe
                ref={iframeRef}
                tabIndex={0}
                title={`Mapa de ${nombre}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://www.google.com/maps?q=${queryMapa}&output=embed`}
                className="w-full h-full border-0"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-superficie flex items-center justify-center border border-borde text-acento shrink-0">
                  <svg
                    className="w-7 h-7"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                    />
                  </svg>
                </div>
                {direccionTexto && (
                  <p className="text-sm sm:text-base text-texto font-cuerpo max-w-xs leading-relaxed">
                    {direccionTexto}
                  </p>
                )}
                <Button
                  type="button"
                  variante="secundario"
                  onClick={activarMapa}
                >
                  Ver mapa
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default Contacto;
