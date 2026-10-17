import { describe, it, expect } from 'vitest';
import {
  formatoPesos,
  normalizarCuenta,
  montosPorModo,
  aplicarPagoConfirmado,
  textoPagoConfirmado,
  traducirErrorPago,
} from './cuenta';

describe('utils/cuenta.js (J-08)', () => {
  describe('formatoPesos', () => {
    it('formatea números a pesos colombianos sin decimales', () => {
      expect(formatoPesos(28000)).toBe('$ 28.000');
      expect(formatoPesos(0)).toBe('$ 0');
      expect(formatoPesos('15500')).toBe('$ 15.500');
    });

    it('maneja valores no numéricos o nulos de forma segura', () => {
      expect(formatoPesos(null)).toBe('$ 0');
      expect(formatoPesos(undefined)).toBe('$ 0');
      expect(formatoPesos(NaN)).toBe('$ 0');
    });
  });

  describe('normalizarCuenta', () => {
    it('normaliza la cuenta de la API colocando al usuario actual de primero', () => {
      const api = {
        id_mesa: 5,
        numero: 5,
        ubicacion: 'Terraza',
        total_mesa: 90000,
        pagado_mesa: 30000,
        saldo_mesa: 60000,
        items_totales: 6,
        comensales: [
          { comensal: 'Ana', items_pedidos: 2, subtotal: 30000, pagado: 0, saldo: 30000 },
          { comensal: 'Beto', items_pedidos: 2, subtotal: 30000, pagado: 10000, saldo: 20000 },
          { comensal: 'Carla', items_pedidos: 2, subtotal: 30000, pagado: 20000, saldo: 10000 },
        ],
      };

      const res = normalizarCuenta(api, 'Beto');

      expect(res.total).toBe(90000);
      expect(res.pagado).toBe(30000);
      expect(res.saldo).toBe(60000);
      expect(res.comensales).toHaveLength(3);
      // Beto debe estar de primero
      expect(res.comensales[0].nombre).toBe('Beto');
      expect(res.comensales[0].esMio).toBe(true);
      expect(res.comensales[0].saldo).toBe(20000);
      expect(res.comensales[0].pago).toBe(false);

      // mia debe reflejar el saldo de Beto
      expect(res.mia).toEqual({
        subtotal: 30000,
        pagado: 10000,
        saldo: 20000,
      });

      // Ana y Carla no son míos
      expect(res.comensales[1].esMio).toBe(false);
      expect(res.comensales[2].esMio).toBe(false);
    });

    it('identifica y envía a "General" al final de la lista', () => {
      const api = {
        total_mesa: 50000,
        pagado_mesa: 0,
        saldo_mesa: 50000,
        comensales: [
          { comensal: 'General', subtotal: 10000, pagado: 0, saldo: 10000 },
          { comensal: 'Ana', subtotal: 20000, pagado: 0, saldo: 20000 },
          { comensal: 'Beto', subtotal: 20000, pagado: 0, saldo: 20000 },
        ],
      };

      const res = normalizarCuenta(api, 'Ana');
      expect(res.comensales[0].nombre).toBe('Ana');
      expect(res.comensales[1].nombre).toBe('Beto');
      expect(res.comensales[2].nombre).toBe('General');
      expect(res.comensales[2].esGeneral).toBe(true);
    });

    it('marca pago: true cuando el saldo de un comensal es 0', () => {
      const api = {
        total_mesa: 20000,
        pagado_mesa: 20000,
        saldo_mesa: 0,
        comensales: [
          { comensal: 'Ana', subtotal: 20000, pagado: 20000, saldo: 0 },
        ],
      };

      const res = normalizarCuenta(api, 'Ana');
      expect(res.comensales[0].pago).toBe(true);
      expect(res.mia.saldo).toBe(0);
    });

    it('devuelve valores por defecto seguros si api es nulo o vacío', () => {
      const res = normalizarCuenta(null, 'Ana');
      expect(res.total).toBe(0);
      expect(res.pagado).toBe(0);
      expect(res.saldo).toBe(0);
      expect(res.comensales).toEqual([]);
      expect(res.mia).toEqual({ subtotal: 0, pagado: 0, saldo: 0 });
    });
  });

  describe('montosPorModo', () => {
    it('calcula propio, igual y total correctamente', () => {
      const cuenta = {
        total: 60000,
        pagado: 0,
        saldo: 60000,
        mia: { saldo: 25000 },
        comensales: [
          { nombre: 'Beto', esGeneral: false },
          { nombre: 'Ana', esGeneral: false },
          { nombre: 'Carla', esGeneral: false },
        ],
      };

      const montos = montosPorModo(cuenta, 3);
      expect(montos.propio).toBe(25000);
      expect(montos.igual).toBe(20000); // 60000 / 3
      expect(montos.total).toBe(60000);
    });

    it('el modo igual nunca excede el saldo restante de la mesa', () => {
      const cuenta = {
        total: 90000,
        pagado: 80000,
        saldo: 10000, // solo faltan 10000
        mia: { saldo: 10000 },
        comensales: [{ nombre: 'Beto' }, { nombre: 'Ana' }],
      };

      const montos = montosPorModo(cuenta, 2);
      expect(montos.igual).toBe(10000); // Math.min(saldo 10000, 90000/2=45000) = 10000
      expect(montos.total).toBe(10000);
    });

    it('si el saldo de la mesa es 0, todos los modos devuelven 0', () => {
      const cuenta = {
        total: 50000,
        pagado: 50000,
        saldo: 0,
        mia: { saldo: 0 },
      };

      const montos = montosPorModo(cuenta, 2);
      expect(montos.propio).toBe(0);
      expect(montos.igual).toBe(0);
      expect(montos.total).toBe(0);
    });
  });

  describe('aplicarPagoConfirmado', () => {
    it('abona al comensal específico y actualiza saldo de la mesa', () => {
      const cuenta = {
        total: 60000,
        pagado: 0,
        saldo: 60000,
        mia: { subtotal: 30000, pagado: 0, saldo: 30000 },
        comensales: [
          { nombre: 'Beto', esMio: true, subtotal: 30000, pagado: 0, saldo: 30000, pago: false },
          { nombre: 'Ana', esMio: false, subtotal: 30000, pagado: 0, saldo: 30000, pago: false },
        ],
      };

      const evento = {
        comensal: 'Beto',
        monto: 30000,
        saldo_restante: 30000,
      };

      const res = aplicarPagoConfirmado(cuenta, evento);
      expect(res.saldo).toBe(30000);
      expect(res.pagado).toBe(30000);
      expect(res.comensales[0].pagado).toBe(30000);
      expect(res.comensales[0].saldo).toBe(0);
      expect(res.comensales[0].pago).toBe(true);
      expect(res.mia.saldo).toBe(0);
      expect(res.comensales[1].saldo).toBe(30000);
    });

    it('con comensal null abona a todos los comensales pendientes', () => {
      const cuenta = {
        total: 50000,
        pagado: 0,
        saldo: 50000,
        mia: { subtotal: 20000, pagado: 0, saldo: 20000 },
        comensales: [
          { nombre: 'Beto', esMio: true, subtotal: 20000, pagado: 0, saldo: 20000, pago: false },
          { nombre: 'Ana', esMio: false, subtotal: 30000, pagado: 0, saldo: 30000, pago: false },
        ],
      };

      const evento = {
        comensal: null,
        monto: 50000,
        saldo_restante: 0,
      };

      const res = aplicarPagoConfirmado(cuenta, evento);
      expect(res.saldo).toBe(0);
      expect(res.pagado).toBe(50000);
      expect(res.comensales[0].pago).toBe(true);
      expect(res.comensales[1].pago).toBe(true);
      expect(res.mia.saldo).toBe(0);
    });

    it('acepta monto_centavos y saldo_restante_centavos', () => {
      const cuenta = {
        total: 20000,
        pagado: 0,
        saldo: 20000,
        mia: { subtotal: 20000, pagado: 0, saldo: 20000 },
        comensales: [
          { nombre: 'Beto', esMio: true, subtotal: 20000, pagado: 0, saldo: 20000, pago: false },
        ],
      };

      const evento = {
        comensal: 'Beto',
        monto_centavos: 2000000,
        saldo_restante_centavos: 0,
      };

      const res = aplicarPagoConfirmado(cuenta, evento);
      expect(res.saldo).toBe(0);
      expect(res.pagado).toBe(20000);
    });
  });

  describe('textoPagoConfirmado', () => {
    it('muestra "Pago confirmado: $X" si el pago fue propio', () => {
      const evento = { comensal: 'Beto', monto: 28000 };
      expect(textoPagoConfirmado(evento, 'Beto')).toBe('Pago confirmado: $ 28.000');
    });

    it('muestra "Carla pagó $X" si fue otro comensal', () => {
      const evento = { comensal: 'Carla', monto: 15000 };
      expect(textoPagoConfirmado(evento, 'Beto')).toBe('Carla pagó $ 15.000');
    });

    it('muestra "Se pagó la cuenta completa" si comensal es null', () => {
      const evento = { comensal: null, monto: 90000 };
      expect(textoPagoConfirmado(evento, 'Beto')).toBe('Se pagó la cuenta completa');
    });
  });

  describe('traducirErrorPago', () => {
    it('traduce 409 o SIN_SALDO', () => {
      expect(traducirErrorPago(409)).toBe('No hay saldo pendiente para pagar');
      expect(traducirErrorPago(null, 'SIN_SALDO')).toBe('No hay saldo pendiente para pagar');
    });

    it('traduce 429 o RATE_LIMIT', () => {
      expect(traducirErrorPago(429)).toBe('Demasiados intentos, espera un minuto');
      expect(traducirErrorPago(null, 'RATE_LIMIT')).toBe('Demasiados intentos, espera un minuto');
    });

    it('traduce 503 NO_CONFIGURADO', () => {
      expect(traducirErrorPago(503, 'NO_CONFIGURADO')).toBe(
        'Los pagos en línea no están disponibles; paga en la caja'
      );
    });

    it('traduce 401 y 403', () => {
      expect(traducirErrorPago(401)).toBe('Tu sesión de la mesa terminó, escanea el QR de nuevo');
      expect(traducirErrorPago(403)).toBe('Tu sesión de la mesa terminó, escanea el QR de nuevo');
    });

    it('traduce errores desconocidos con mensaje genérico', () => {
      expect(traducirErrorPago(500)).toBe('No pudimos iniciar el pago, intenta de nuevo');
    });
  });
});
