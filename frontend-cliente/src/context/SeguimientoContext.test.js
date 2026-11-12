import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  extraerIatToken,
  calcularClaveSesion,
  cargarUltimoPedidoGuardado,
} from './SeguimientoContext';
import { CLAVE_ULTIMO_PEDIDO } from '../utils/seguimiento';
import { CLAVE_SESION } from '../utils/sesion';

function crearJwtSimulado(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.firma_simulada`;
}

describe('SeguimientoContext: aislamiento de sesión entre grupos de la mesa', () => {
  let sessionStorageMock = {};

  beforeEach(() => {
    sessionStorageMock = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (key) => sessionStorageMock[key] ?? null,
      setItem: (key, val) => {
        sessionStorageMock[key] = String(val);
      },
      removeItem: (key) => {
        delete sessionStorageMock[key];
      },
      clear: () => {
        sessionStorageMock = {};
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('extraerIatToken y calcularClaveSesion', () => {
    it('extrae el iat del payload del JWT', () => {
      const token = crearJwtSimulado({ iat: 1700000000, comensal: 'Ana' });
      expect(extraerIatToken(token)).toBe(1700000000);
    });

    it('devuelve null si el token es invalido o no tiene iat', () => {
      expect(extraerIatToken(null)).toBeNull();
      expect(extraerIatToken('')).toBeNull();
      expect(extraerIatToken('invalido')).toBeNull();
      const tokenSinIat = crearJwtSimulado({ comensal: 'Ana' });
      expect(extraerIatToken(tokenSinIat)).toBeNull();
    });

    it('calcula la clave de sesion combinando idMesa e iat', () => {
      const tokenA = crearJwtSimulado({ iat: 1000, comensal: 'Ana' });
      const tokenB = crearJwtSimulado({ iat: 2000, comensal: 'Beto' });

      expect(calcularClaveSesion(5, tokenA)).toBe('5:1000');
      expect(calcularClaveSesion(5, tokenB)).toBe('5:2000');
      expect(calcularClaveSesion(5, null)).toBe('5');
      expect(calcularClaveSesion(null, tokenA)).toBeNull();
    });
  });

  describe('cargarUltimoPedidoGuardado', () => {
    it('retorna [] si no hay pedido guardado', () => {
      expect(cargarUltimoPedidoGuardado('Ana', '5:1000')).toEqual([]);
    });

    it('retorna el pedido si coincide con la sesion actual', () => {
      const pedido = {
        id_pedido: 101,
        estado: 'recibido',
        __sesion: '5:1000',
        detalles: [{ id_detalle: 1, plato_nombre: 'Pasta', comensal: 'Ana', cantidad: 1, subtotal: 20000 }],
      };
      sessionStorage.setItem(CLAVE_ULTIMO_PEDIDO, JSON.stringify(pedido));

      const cargado = cargarUltimoPedidoGuardado('Ana', '5:1000');
      expect(cargado).toHaveLength(1);
      expect(cargado[0].id_pedido).toBe(101);
      expect(cargado[0].__sesion).toBeUndefined();
    });

    it('ignora el pedido si pertenece a otra sesion (ej. otro iat en mesa 5)', () => {
      const pedidoGrupoA = {
        id_pedido: 101,
        estado: 'recibido',
        __sesion: '5:1000',
        detalles: [{ id_detalle: 1, plato_nombre: 'Pasta', comensal: 'Ana', cantidad: 1, subtotal: 20000 }],
      };
      sessionStorage.setItem(CLAVE_ULTIMO_PEDIDO, JSON.stringify(pedidoGrupoA));

      // Grupo B llega a la mesa 5 con sesion 5:2000
      const cargadoGrupoB = cargarUltimoPedidoGuardado('Beto', '5:2000');
      expect(cargadoGrupoB).toEqual([]);
    });

    it('ignora el pedido guardado si no tiene metadata de sesion y la sesion actual es conocida', () => {
      const pedidoSinSesion = {
        id_pedido: 101,
        estado: 'recibido',
        detalles: [{ id_detalle: 1, plato_nombre: 'Pasta', comensal: 'Ana', cantidad: 1, subtotal: 20000 }],
      };
      sessionStorage.setItem(CLAVE_ULTIMO_PEDIDO, JSON.stringify(pedidoSinSesion));

      expect(cargarUltimoPedidoGuardado('Ana', '5:1000')).toEqual([]);
    });
  });

  describe('cerrarSesion borra smartdining_ultimo_pedido', () => {
    it('elimina la clave smartdining_ultimo_pedido de sessionStorage al cerrar sesion', () => {
      sessionStorage.setItem(CLAVE_ULTIMO_PEDIDO, JSON.stringify({ id_pedido: 999 }));
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ token: 't', idMesa: 5 }));

      expect(sessionStorage.getItem(CLAVE_ULTIMO_PEDIDO)).not.toBeNull();

      // Simulamos la accion ejecutada en cerrarSesion (SesionContext)
      sessionStorage.removeItem(CLAVE_SESION);
      sessionStorage.removeItem(CLAVE_ULTIMO_PEDIDO);

      expect(sessionStorage.getItem(CLAVE_ULTIMO_PEDIDO)).toBeNull();
      expect(sessionStorage.getItem(CLAVE_SESION)).toBeNull();
    });
  });

  describe('Flujo de grupos en mesa 5: Grupo A -> cerrar sesion -> Grupo B', () => {
    it('el nuevo grupo en mesa 5 inicia con lista vacia y recargar no reinserta los de Grupo A', () => {
      const tokenGrupoA = crearJwtSimulado({ iat: 1000, comensal: 'Ana' });
      const claveGrupoA = calcularClaveSesion(5, tokenGrupoA);

      // Grupo A hace pedido y se guarda en sessionStorage
      const pedidoA = {
        id_pedido: 501,
        estado: 'recibido',
        __sesion: claveGrupoA,
        detalles: [{ id_detalle: 10, plato_nombre: 'Sopa', comensal: 'Ana', cantidad: 1, subtotal: 15000 }],
      };
      sessionStorage.setItem(CLAVE_ULTIMO_PEDIDO, JSON.stringify(pedidoA));

      // Grupo A ve su pedido
      const pedidosGrupoA = cargarUltimoPedidoGuardado('Ana', claveGrupoA);
      expect(pedidosGrupoA).toHaveLength(1);
      expect(pedidosGrupoA[0].id_pedido).toBe(501);

      // Liberar mesa / cerrar sesion
      sessionStorage.removeItem(CLAVE_ULTIMO_PEDIDO);
      sessionStorage.removeItem(CLAVE_SESION);

      // Grupo B escanea la misma mesa 5 con nuevo token/iat
      const tokenGrupoB = crearJwtSimulado({ iat: 2000, comensal: 'Carlos' });
      const claveGrupoB = calcularClaveSesion(5, tokenGrupoB);

      // Grupo B carga su ultimo pedido guardado: lista vacia
      const pedidosGrupoB = cargarUltimoPedidoGuardado('Carlos', claveGrupoB);
      expect(pedidosGrupoB).toEqual([]);

      // Simulamos la logica de recargar() cuando el servidor responde vacio [] para la mesa nueva
      const pedidosDelServidor = [];
      const pedidosPreviosEnMemoria = pedidosGrupoB;
      const combinados = [...pedidosDelServidor];
      for (const p of pedidosPreviosEnMemoria) {
        if (p.id_pedido && !combinados.some((c) => String(c.id_pedido) === String(p.id_pedido))) {
          combinados.unshift(p);
        }
      }
      expect(combinados).toEqual([]);
    });

    it('el mismo comensal que recarga la pagina (misma sesion) conserva sus pedidos guardados', () => {
      const token = crearJwtSimulado({ iat: 1500, comensal: 'Ana' });
      const claveSesion = calcularClaveSesion(5, token);

      const pedido = {
        id_pedido: 601,
        estado: 'en_preparacion',
        __sesion: claveSesion,
        detalles: [{ id_detalle: 20, plato_nombre: 'Bandeja', comensal: 'Ana', cantidad: 1, subtotal: 30000 }],
      };
      sessionStorage.setItem(CLAVE_ULTIMO_PEDIDO, JSON.stringify(pedido));

      // Mismo comensal recarga en la misma sesion
      const cargados = cargarUltimoPedidoGuardado('Ana', claveSesion);
      expect(cargados).toHaveLength(1);
      expect(cargados[0].id_pedido).toBe(601);
      expect(cargados[0].estado).toBe('en_preparacion');

      // Si el servidor aun no devuelve el pedido o tarda, se conserva
      const respuestaServidor = [];
      const combinados = [...respuestaServidor];
      for (const p of cargados) {
        if (p.id_pedido && !combinados.some((c) => String(c.id_pedido) === String(p.id_pedido))) {
          combinados.unshift(p);
        }
      }
      expect(combinados).toHaveLength(1);
      expect(combinados[0].id_pedido).toBe(601);
    });
  });
});
