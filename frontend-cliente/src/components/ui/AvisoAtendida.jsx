/**
 * Aviso de `mesa:atendida` («Tu mesero ya va en camino» / «El mesero va con tu
 * cuenta»), con el estilo comanda de la PWA (carbón y ámbar).
 *
 * - enLinea: dentro del flujo de la página (en /pago, para no tapar nada).
 * - Si no, banda fija abajo a la altura `bottom` (ver posicionAvisoAtendida).
 * Se cierra solo (lo controla Layout) y con el botón ✕.
 */
function AvisoAtendida({ aviso, onCerrar, enLinea = false, bottom = null }) {
  if (!aviso) return null;

  const posicion = enLinea
    ? 'relative w-full mt-3'
    : 'fixed left-1/2 -translate-x-1/2 z-40 w-[min(440px,calc(100%-28px))]';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="aviso-atendida"
      data-tipo={aviso.tipo}
      className={`${posicion} bg-carbon text-ambar border-2 border-carbon rounded-2xl pl-4 pr-2 py-1.5 flex items-center gap-2.5 shadow-2xl toast-entra`}
      style={enLinea || !bottom ? undefined : { bottom }}
    >
      <span className="w-2 h-2 rounded-full shrink-0 bg-ambar" aria-hidden="true" />
      <span className="flex-1 min-w-0 font-etiqueta font-bold uppercase tracking-wide text-sm leading-snug">
        {aviso.mensaje}
      </span>
      <button
        type="button"
        onClick={onCerrar}
        className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-ambar/80 hover:text-ambar cursor-pointer"
        aria-label="Cerrar aviso"
      >
        ✕
      </button>
    </div>
  );
}

export default AvisoAtendida;
