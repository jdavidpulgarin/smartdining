/**
 * Sección de videos de especialidades.
 * Solo se renderiza si existen elementos en datosRestaurante.videos.
 */
function Videos({ datosRestaurante = {} }) {
  const videos = datosRestaurante.videos;
  if (!Array.isArray(videos) || videos.length === 0) {
    return null;
  }

  return (
    <section
      id="videos"
      aria-labelledby="titulo-videos"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16 space-y-8"
    >
      <div className="space-y-2">
        <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
          Multimedia
        </span>
        <h2
          id="titulo-videos"
          className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none"
        >
          Videos
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {videos.map((vid, idx) => (
          <article
            key={vid.archivo || idx}
            className="bg-superficie rounded-3xl border border-borde overflow-hidden shadow-lg flex flex-col justify-between"
          >
            <div className="relative aspect-video bg-superficie-2 border-b border-borde overflow-hidden">
              <video
                controls
                muted
                playsInline
                preload="none"
                poster={vid.poster}
                width={640}
                height={360}
                className="w-full h-full object-cover"
              >
                <source src={vid.archivo} type="video/mp4" />
                Tu navegador no soporta la reproducción de video.
              </video>
            </div>

            <div className="p-5 space-y-2 flex-1 flex flex-col justify-between">
              <div className="space-y-1">
                <h3 className="font-titulo text-2xl uppercase tracking-wide text-texto">
                  {vid.titulo}
                </h3>
                {vid.descripcion && (
                  <p className="text-sm text-texto-suave font-cuerpo leading-relaxed">
                    {vid.descripcion}
                  </p>
                )}
              </div>

              {vid.ia && (
                <p className="text-xs text-texto-tenue font-cuerpo italic pt-2 border-t border-borde/40">
                  Video generado con IA
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default Videos;
