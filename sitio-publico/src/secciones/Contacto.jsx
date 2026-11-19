import { useEffect, useMemo, useRef, useState } from 'react';
import TituloSeccion from '../componentes/TituloSeccion.jsx';
import Button from '../components/ui/Button.jsx';
import IconoRed from '../componentes/IconoRed.jsx';
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

const DIAS_EN_A_ES = {
  Monday: 'lunes',
  Tuesday: 'martes',
  Wednesday: 'miercoles',
  Thursday: 'jueves',
  Friday: 'viernes',
  Saturday: 'sabado',
  Sunday: 'domingo',
};

function obtenerDiaActualBogota() {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Bogota',
      weekday: 'long',
    });
    const diaEn = dtf.format(new Date());
    return DIAS_EN_A_ES[diaEn] || 'lunes';
  } catch {
    return 'lunes';
  }
}

/**
 * Sección 'Contacto' al estilo póster de restaurante.
 * - Título 'Ven y / escríbenos'.
 * - Tarjetas-enlace para WhatsApp, Llámanos y Correo.
 * - Horario semanal en comanda de papel crema con corte zigzag y día de hoy resaltado.
 * - Mapa interactivo bajo demanda con fachada y enlaces de cómo llegar.
 * - Redes sociales institucionales.
 */
function Contacto({ datosRestaurante = restauranteDefault, mapaVisibleInicial = false }) {
  const nombre = datosRestaurante.nombre || 'SmartDining Restaurante';
  const direccion = datosRestaurante.direccion;
  const horario = datosRestaurante.horario || restauranteDefault.horario;

  const [mapaVisible, setMapaVisible] = useState(() => Boolean(mapaVisibleInicial));
  const iframeRef = useRef(null);

  const [estado, setEstado] = useState(() => estadoHorario(new Date(), horario));
  const [diaHoy, setDiaHoy] = useState(() => obtenerDiaActualBogota());

  useEffect(() => {
    setEstado(estadoHorario(new Date(), horario));
    setDiaHoy(obtenerDiaActualBogota());
    const timer = setInterval(() => {
      setEstado(estadoHorario(new Date(), horario));
      setDiaHoy(obtenerDiaActualBogota());
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
      aria-labelledby="contacto-titulo"
      className="fondo-poster-brillo-bl text-papel py-16 sm:py-24 scroll-mt-16 border-b border-papel/10"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
        <TituloSeccion
          id="contacto-titulo"
          linea1="Ven y"
          linea2="escríbenos"
          descripcion="Estamos en el centro de Valledupar, todos los días. Si prefieres, pregunta por WhatsApp."
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Columna izquierda: Enlaces rápidos y Horario en comanda */}
          <div className="lg:col-span-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* WhatsApp ancho en rojo */}
              {urlWhatsapp && (
                <a
                  href={urlWhatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sm:col-span-2 bg-primario border border-primario rounded-xl p-5 text-white flex flex-col gap-2 relative overflow-hidden group hover:scale-[1.01] transition-transform shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
                >
                  <span className="etiqueta-girada bg-white text-tinta text-xs font-titulo tracking-wider px-2.5 py-0.5 self-start">
                    WhatsApp
                  </span>
                  <b className="font-titulo text-3xl sm:text-4xl tracking-wide text-white">
                    {datosRestaurante.whatsappVisible}
                  </b>
                  <span className="text-sm font-cuerpo-poster text-white/90">
                    Escríbenos y te respondemos al momento.
                  </span>
                </a>
              )}

              {/* Llámanos */}
              {datosRestaurante.telefono && (
                <a
                  href={`tel:${datosRestaurante.telefono}`}
                  className="bg-[#161010] border border-papel/15 rounded-xl p-5 text-papel flex flex-col gap-2 hover:border-primario transition-colors shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
                >
                  <span className="etiqueta-girada text-xs font-titulo tracking-wider px-2.5 py-0.5 self-start">
                    Llámanos
                  </span>
                  <b className="font-titulo text-2xl sm:text-3xl tracking-wide text-papel">
                    {datosRestaurante.telefonoVisible}
                  </b>
                </a>
              )}

              {/* Correo */}
              {datosRestaurante.correo && (
                <a
                  href={`mailto:${datosRestaurante.correo}`}
                  className="bg-[#161010] border border-papel/15 rounded-xl p-5 text-papel flex flex-col gap-2 hover:border-primario transition-colors shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
                >
                  <span className="etiqueta-girada text-xs font-titulo tracking-wider px-2.5 py-0.5 self-start">
                    Correo
                  </span>
                  <b className="font-titulo text-base sm:text-lg lg:text-xl tracking-wide text-papel">
                    {(() => {
                      const correo = datosRestaurante.correo;
                      const partes = correo.split('@');
                      if (partes.length === 2) {
                        return (
                          <>
                            {partes[0]}@<wbr />{partes[1]}
                          </>
                        );
                      }
                      return correo;
                    })()}
                  </b>
                </a>
              )}
            </div>

            {/* Horario como comanda de papel con zigzag */}
            <div className="filter drop-shadow-xl pt-2">
              <div className="comanda p-6 sm:p-7 pb-10">
                <div className="flex justify-between items-center gap-3 pb-3 border-b-2 border-dashed border-tinta/35">
                  <strong className="font-titulo text-2xl sm:text-3xl tracking-wider uppercase text-tinta">
                    HORARIO
                  </strong>
                  <span
                    role="status"
                    className="inline-flex items-center gap-2 text-xs font-cuerpo-poster font-semibold text-tinta"
                  >
                    <span
                      aria-hidden="true"
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        estado.abierto ? 'bg-exito' : 'bg-primario'
                      }`}
                    />
                    <span>{estado.texto}</span>
                  </span>
                </div>

                <ul className="list-none m-0 p-0 pt-2">
                  {DIAS_SEMANA.map(({ clave, etiqueta }) => {
                    const dia = horario?.[clave];
                    const horas =
                      dia?.abre && dia?.cierra
                        ? `${dia.abre} – ${dia.cierra}`
                        : 'Cerrado';
                    const esHoy = diaHoy === clave;

                    return (
                      <li
                        key={clave}
                        aria-current={esHoy ? 'date' : undefined}
                        className={`flex items-baseline gap-3 py-1.5 border-b border-dashed border-tinta/20 last:border-b-0 ${
                          esHoy
                            ? 'bg-ambar/35 -mx-2 px-2 rounded font-bold'
                            : ''
                        }`}
                      >
                        <span className="font-titulo text-lg sm:text-xl uppercase tracking-wide text-tinta">
                          {etiqueta}
                        </span>
                        <span
                          aria-hidden="true"
                          className="flex-1 border-b-2 border-dotted border-tinta/30 translate-y-[-4px]"
                        />
                        <span className="font-titulo text-lg sm:text-xl tracking-wide text-tinta">
                          {horas}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <p className="mt-5 text-xs font-cuerpo-poster font-semibold text-center text-tinta/85 m-0">
                  {datosRestaurante.horarioVisible ||
                    'Todos los días, de 11:30 a. m. a 11:00 p. m.'}
                </p>
              </div>
            </div>
          </div>

          {/* Columna derecha: Mapa interactivo y Redes sociales */}
          <div className="lg:col-span-6 bg-[#161010] border border-papel/15 rounded-2xl overflow-hidden flex flex-col shadow-xl">
            <div className="p-5 sm:p-6 flex flex-wrap justify-between items-center gap-4">
              <div>
                <h3 className="font-titulo text-2xl sm:text-3xl uppercase tracking-wider text-papel m-0">
                  Dónde estamos
                </h3>
                {direccionTexto && (
                  <address className="not-italic text-sm text-papel/70 font-cuerpo-poster mt-1">
                    {direccionTexto}
                  </address>
                )}
              </div>
              <a
                href={`https://www.google.com/maps?q=${queryMapa}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir en Google Maps"
                className="min-h-11 px-5 rounded-full bg-primario hover:bg-primario-hover text-white font-titulo text-lg uppercase tracking-wider inline-flex items-center transition-colors shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
              >
                <span>Cómo llegar</span>
                <span className="sr-only"> (Abrir en Google Maps)</span>
              </a>
            </div>

            {/* Marco de mapa con fachada bajo demanda */}
            <div className="relative border-t-2 border-dashed border-papel/20 aspect-[4/3] sm:aspect-[16/10] bg-[#1b1212]">
              {mapaVisible ? (
                <iframe
                  ref={iframeRef}
                  tabIndex={0}
                  title={`Mapa de ${nombre}`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.google.com/maps?q=${queryMapa}&output=embed`}
                  className="absolute inset-0 w-full h-full border-0"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-[#161010] flex items-center justify-center border border-papel/20 text-ambar shrink-0">
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
                    <p className="text-sm font-cuerpo-poster text-papel/80 max-w-xs m-0">
                      {direccionTexto}
                    </p>
                  )}
                  <Button
                    type="button"
                    variante="secundario"
                    onClick={activarMapa}
                    className="font-titulo text-lg uppercase tracking-wider border-papel/40 text-papel hover:bg-papel/10"
                  >
                    Ver mapa
                  </Button>
                </div>
              )}
            </div>

            {/* Redes sociales */}
            {Array.isArray(datosRestaurante.redes) &&
              datosRestaurante.redes.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 p-5 border-t border-papel/15">
                  <span className="font-titulo text-lg text-papel/60 uppercase tracking-wider mr-1">
                    Síguenos
                  </span>
                  {datosRestaurante.redes.map((red) => (
                    <a
                      key={red.nombre}
                      href={red.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-10 px-4 py-1.5 rounded-full border border-papel/20 text-papel hover:border-ambar hover:bg-ambar/10 font-titulo text-base uppercase tracking-wider transition-colors inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
                    >
                      <IconoRed red={red.nombre} />
                      <span>{red.nombre}</span>
                    </a>
                  ))}
                </div>
              )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default Contacto;
