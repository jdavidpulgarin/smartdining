/**
 * La marca, en CSS: un cuadrado rojo con "SD" y, al lado, el nombre de la
 * pantalla. No es una imagen a proposito — un SVG o un PNG mas que cargar en
 * una pantalla que puede arrancar sin red, para dos letras.
 *
 * El `title` lleva quien tiene la sesion abierta: el diseño quita del tablero
 * la linea con el nombre y el rol, pero ese dato sigue haciendo falta cuando
 * hay que saber con que usuario quedo abierta la pantalla de la cocina.
 */
export default function Logo({ texto, titulo, nota }) {
  return (
    <div className="flex items-center gap-3" title={titulo || undefined}>
      <span
        className="display grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[color:var(--color-marca)] text-xl font-bold text-white"
        aria-hidden="true"
      >
        SD
      </span>
      <div className="leading-none">
        <p className="display text-3xl font-bold leading-none text-[color:var(--color-marca)]">
          {texto}
        </p>
        {nota && (
          <p className="display mt-1 text-sm font-semibold leading-none text-[color:var(--color-texto-suave)]">
            {nota}
          </p>
        )}
      </div>
      {titulo && <span className="sr-only">{titulo}</span>}
    </div>
  )
}
