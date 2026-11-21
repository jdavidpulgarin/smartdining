import { describe, it, expect } from 'vitest';
import {
  MENSAJES_ATENDIDA,
  DURACION_AVISO_ATENDIDA_MS,
  avisoDeAtendida,
  crearControlAvisoAtendida,
  posicionAvisoAtendida,
} from './avisoAtendida';

const ev = (tipo, extra = {}) => ({
  eventId: `evt-${Math.random().toString(36).slice(2)}`,
  id_mesa: 10,
  tipo,
  emitidoEn: new Date().toISOString(),
  ...extra,
});

// Reloj falso: guarda los temporizadores y deja dispararlos a mano.
function relojFalso() {
  let siguiente = 1;
  const pendientes = new Map();
  return {
    programar: (fn, ms) => {
      const h = siguiente++;
      pendientes.set(h, { fn, ms });
      return h;
    },
    cancelar: (h) => pendientes.delete(h),
    pendientes,
    dispararTodo() {
      const lista = [...pendientes.values()];
      pendientes.clear();
      lista.forEach((p) => p.fn());
    },
  };
}

function control() {
  const reloj = relojFalso();
  const cambios = [];
  const c = crearControlAvisoAtendida({
    alCambiar: (a) => cambios.push(a),
    programar: reloj.programar,
    cancelar: reloj.cancelar,
  });
  return { c, reloj, cambios };
}

describe('avisoDeAtendida', () => {
  it("'llamado' → «Tu mesero ya va en camino» y 'cuenta' → «El mesero va con tu cuenta»", () => {
    expect(avisoDeAtendida(ev('llamado'), 10)).toMatchObject({ tipo: 'llamado', mensaje: 'Tu mesero ya va en camino' });
    expect(avisoDeAtendida(ev('cuenta'), 10)).toMatchObject({ tipo: 'cuenta', mensaje: 'El mesero va con tu cuenta' });
    expect(MENSAJES_ATENDIDA).toEqual({ llamado: 'Tu mesero ya va en camino', cuenta: 'El mesero va con tu cuenta' });
  });

  it('id_mesa de otra mesa, tipo inválido o sesión sin mesa → null', () => {
    expect(avisoDeAtendida(ev('llamado', { id_mesa: 11 }), 10)).toBeNull();
    expect(avisoDeAtendida(ev('llamado', { id_mesa: undefined }), 10)).toBeNull();
    for (const tipo of ['pedido', 'LLAMADO', '', null, undefined, 'toString', '__proto__']) {
      expect(avisoDeAtendida(ev(tipo), 10)).toBeNull();
    }
    expect(avisoDeAtendida(ev('llamado'), null)).toBeNull();
    expect(avisoDeAtendida(ev('llamado'), 0)).toBeNull();
    expect(avisoDeAtendida(null, 10)).toBeNull();
    expect(avisoDeAtendida('mesa:atendida', 10)).toBeNull();
  });

  it('compara con el id_mesa de la sesión aunque llegue como texto', () => {
    expect(avisoDeAtendida(ev('cuenta'), '10')).not.toBeNull();
  });
});

describe('crearControlAvisoAtendida', () => {
  it('muestra el aviso y se cierra solo a los 6 s', () => {
    const { c, reloj, cambios } = control();
    expect(c.recibir(ev('llamado'), 10)).toBe(true);
    expect(c.actual.mensaje).toBe('Tu mesero ya va en camino');
    expect([...reloj.pendientes.values()].map((p) => p.ms)).toEqual([DURACION_AVISO_ATENDIDA_MS]);
    expect(DURACION_AVISO_ATENDIDA_MS).toBe(6000);

    reloj.dispararTodo();
    expect(c.actual).toBeNull();
    expect(cambios.at(-1)).toBeNull();
  });

  it('se cierra a mano y el reloj ya no hace nada', () => {
    const { c, reloj, cambios } = control();
    c.recibir(ev('cuenta'), 10);
    c.cerrar();
    expect(c.actual).toBeNull();
    expect(reloj.pendientes.size).toBe(0);
    expect(cambios).toHaveLength(2);
    c.cerrar(); // cerrar dos veces no avisa de nuevo
    expect(cambios).toHaveLength(2);
  });

  it('un segundo aviso REEMPLAZA al primero (solo uno) y reinicia el reloj', () => {
    const { c, reloj, cambios } = control();
    c.recibir(ev('llamado'), 10);
    c.recibir(ev('cuenta'), 10);
    expect(c.actual.mensaje).toBe('El mesero va con tu cuenta');
    expect(reloj.pendientes.size).toBe(1); // el reloj del primero se canceló
    expect(cambios.map((a) => a?.tipo)).toEqual(['llamado', 'cuenta']);

    // El cliente pide otra vez y llega otro llamado: reemplaza, no se apila.
    c.recibir(ev('llamado'), 10);
    expect(c.actual.tipo).toBe('llamado');
    expect(reloj.pendientes.size).toBe(1);
  });

  it('el reloj viejo no cierra el aviso nuevo', () => {
    const reloj = relojFalso();
    const c = crearControlAvisoAtendida({ alCambiar: () => {}, programar: reloj.programar, cancelar: () => {} });
    c.recibir(ev('llamado'), 10);
    const [viejo] = reloj.pendientes.values();
    c.recibir(ev('cuenta'), 10);
    viejo.fn(); // el temporizador del primero dispara tarde
    expect(c.actual?.tipo).toBe('cuenta');
  });

  it('el mismo eventId dos veces = un aviso', () => {
    const { c, cambios } = control();
    const e = ev('llamado');
    expect(c.recibir(e, 10)).toBe(true);
    c.cerrar();
    expect(c.recibir(e, 10)).toBe(false);
    expect(c.recibir({ ...e }, 10)).toBe(false);
    expect(cambios.filter(Boolean)).toHaveLength(1);
    expect(c.actual).toBeNull();
  });

  it('otra mesa o tipo inválido: nada (ni aviso ni reloj)', () => {
    const { c, reloj, cambios } = control();
    expect(c.recibir(ev('llamado', { id_mesa: 11 }), 10)).toBe(false);
    expect(c.recibir(ev('pedido'), 10)).toBe(false);
    expect(c.actual).toBeNull();
    expect(cambios).toEqual([]);
    expect(reloj.pendientes.size).toBe(0);
  });

  it('un evento ignorado no gasta su eventId', () => {
    const { c } = control();
    const e = ev('cuenta', { id_mesa: 11 });
    expect(c.recibir(e, 10)).toBe(false);
    expect(c.recibir({ ...e, id_mesa: 10 }, 10)).toBe(true);
  });

  it('destruir para el reloj sin avisar', () => {
    const { c, reloj, cambios } = control();
    c.recibir(ev('llamado'), 10);
    c.destruir();
    expect(reloj.pendientes.size).toBe(0);
    expect(cambios).toHaveLength(1);
  });
});

describe('posicionAvisoAtendida', () => {
  it('/pago: dentro del flujo (no fixed)', () => {
    expect(posicionAvisoAtendida({ ruta: '/pago', hayCarrito: true })).toEqual({ enLinea: true, bottom: null });
  });

  it('con «La carta cambió» abierto: dentro del flujo, para no tapar su botón', () => {
    expect(posicionAvisoAtendida({ ruta: '/menu', hayCarrito: true, hayAvisosMenu: true }).enLinea).toBe(true);
  });

  it('/menu con la barra del carrito: banda fija encima de la barra y del safe-area', () => {
    const p = posicionAvisoAtendida({ ruta: '/menu', hayCarrito: true });
    expect(p.enLinea).toBe(false);
    expect(p.bottom).toContain('env(safe-area-inset-bottom)');
    expect(p.bottom).toContain('140px');
  });

  it('/armar/:id: encima de la BottomBar', () => {
    const p = posicionAvisoAtendida({ ruta: '/armar/7' });
    expect(p.bottom).toBe('calc(env(safe-area-inset-bottom) + 92px)');
  });

  it('/seguimiento, /carrito y /menu sin carrito: abajo, respetando el safe-area', () => {
    for (const ruta of ['/seguimiento', '/carrito', '/menu']) {
      expect(posicionAvisoAtendida({ ruta })).toEqual({ enLinea: false, bottom: 'max(14px, env(safe-area-inset-bottom))' });
    }
  });
});
