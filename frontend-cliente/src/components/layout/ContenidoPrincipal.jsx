import AvisoAtendida from '../ui/AvisoAtendida';

/**
 * El <main> de Layout. Cuando el aviso de mesa:atendida va en el flujo (en
 * /pago), queda aquí, arriba del contenido de la pantalla: empuja la página en
 * vez de taparla.
 */
function ContenidoPrincipal({ esComanda, avisoAtendida = null, posicionAviso = null, onCerrarAviso, children }) {
  return (
    <main
      id="contenido-principal"
      tabIndex={-1}
      className={`flex-1 w-full max-w-[480px] mx-auto px-4 focus:outline-none ${esComanda ? 'pb-28' : 'pb-8'}`}
    >
      {avisoAtendida && posicionAviso?.enLinea && (
        <div className="mb-3.5">
          <AvisoAtendida aviso={avisoAtendida} onCerrar={onCerrarAviso} enLinea />
        </div>
      )}
      {children}
    </main>
  );
}

export default ContenidoPrincipal;
