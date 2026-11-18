/**
 * Registro de oyentes para el socket de la mesa.
 *
 * Permite a los componentes registrar oyentes en cualquier momento (incluso
 * antes de que el socket conecte o durante reconexiones), manteniendo
 * suscripciones activas y una identidad estable de la función `on`.
 */
export function crearRegistroOyentes() {
  /** @type {Map<string, Set<Function>>} */
  const registro = new Map();

  let clienteActivo = null;

  /** @type {Map<string, Map<Function, Function>>} */
  const bajasActivas = new Map();

  function adjuntar(evento, fn) {
    if (!clienteActivo || typeof clienteActivo.on !== 'function') return;

    let bajasEvento = bajasActivas.get(evento);
    if (!bajasEvento) {
      bajasEvento = new Map();
      bajasActivas.set(evento, bajasEvento);
    }

    if (bajasEvento.has(fn)) return;

    const baja = clienteActivo.on(evento, fn);
    if (typeof baja === 'function') {
      bajasEvento.set(fn, baja);
    }
  }

  function desadjuntar(evento, fn) {
    const bajasEvento = bajasActivas.get(evento);
    if (bajasEvento) {
      const baja = bajasEvento.get(fn);
      if (typeof baja === 'function') {
        baja();
      }
      bajasEvento.delete(fn);
      if (bajasEvento.size === 0) {
        bajasActivas.delete(evento);
      }
    }
  }

  return {
    agregar(evento, fn) {
      if (typeof fn !== 'function') return () => {};

      let fns = registro.get(evento);
      if (!fns) {
        fns = new Set();
        registro.set(evento, fns);
      }
      fns.add(fn);

      if (clienteActivo) {
        adjuntar(evento, fn);
      }

      return () => {
        const setActual = registro.get(evento);
        if (setActual) {
          setActual.delete(fn);
          if (setActual.size === 0) {
            registro.delete(evento);
          }
        }
        desadjuntar(evento, fn);
      };
    },

    conectar(cliente) {
      if (clienteActivo) {
        this.desconectar();
      }
      clienteActivo = cliente;
      if (!cliente || typeof cliente.on !== 'function') return;

      for (const [evento, fns] of registro.entries()) {
        for (const fn of fns) {
          adjuntar(evento, fn);
        }
      }
    },

    desconectar() {
      for (const bajasEvento of bajasActivas.values()) {
        for (const baja of bajasEvento.values()) {
          if (typeof baja === 'function') {
            baja();
          }
        }
        bajasEvento.clear();
      }
      bajasActivas.clear();
      clienteActivo = null;
    },
  };
}

export default crearRegistroOyentes;
