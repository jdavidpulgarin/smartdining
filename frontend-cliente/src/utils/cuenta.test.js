import { describe, it, expect } from 'vitest';
import {
  formatoPesos,
  normalizarCuenta,
  montosPorModo,
  personasPorPagar,
  montoIgualCentavos,
  personasDividir,
  aplicarPagoConfirmado,
  textoPagoConfirmado,
  traducirErrorPago,
  ESTADO_CUENTA_INICIAL,
  ESTADO_CUENTA_ENVIANDO,
  estadoCuentaSolicitada,
  textoCajaSegunEstado,
  avisoPedidoGrupal,
  TEXTO_SUGERENCIA_SIN_CELULAR,
  debeMostrarSugerenciaSinCelular,
  debeSalirDeEspera,
  mensajePagoConfirmado,
  textoDetalleConfirmacion,
  eventIdParaIntento,
  estadoSelectorPago,
  infoTuParte,
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

  describe('personasPorPagar', () => {
    it('yo no está en comensales → igual cuenta', () => {
      const n = personasPorPagar({
        comensales: ['Ana'],
        pagaron: [],
        yo: 'Beto',
      });
      expect(n).toBe(2);
    });

    it('yo ya está en pagaron → igual cuenta', () => {
      const n = personasPorPagar({
        comensales: ['Ana', 'Beto'],
        pagaron: ['Ana', 'Beto'],
        yo: 'Ana',
      });
      expect(n).toBe(1);
    });

    it('devuelve mínimo 1 aunque comensales y pagaron estén vacíos', () => {
      expect(personasPorPagar()).toBe(1);
    });
  });

  describe('personasDividir', () => {
    it('con presencia usa personasPorPagar', () => {
      const cuenta = { comensales: [] };
      const presencia = { comensales: ['Ana', 'Beto'], pagaron: ['Ana'] };
      expect(personasDividir(cuenta, { presencia, yo: 'Beto' })).toBe(1);
      expect(personasDividir(cuenta, { presencia, yo: 'Carlos' })).toBe(2);
    });

    it('respaldo sin presencia: cuenta comensales con saldo > 0 y no General, sumando yo', () => {
      const cuenta = {
        saldo: 50000,
        comensales: [
          { nombre: 'Ana', saldo: 20000, esGeneral: false },
          { nombre: 'Beto', saldo: 0, esGeneral: false },
          { nombre: 'General', saldo: 10000, esGeneral: true },
        ],
      };
      expect(personasDividir(cuenta, { yo: 'Carlos' })).toBe(2);
      expect(personasDividir(cuenta, { yo: 'Ana' })).toBe(1);
    });
  });

  describe('montoIgualCentavos y 5 filas de EVENTS.md §8.1 (en centavos)', () => {
    it('2 personas, $85.000: Ana propio $20.000 → Beto igual $65.000', () => {
      const montoBeto = montoIgualCentavos(6500000, 1);
      expect(montoBeto).toBe(6500000); // $65.000
    });

    it('3 personas, $100.000: Ana propio $30.000 → Beto $35.000 → Carlos $35.000', () => {
      const montoBeto = montoIgualCentavos(7000000, 2);
      expect(montoBeto).toBe(3500000); // $35.000

      const montoCarlos = montoIgualCentavos(3500000, 1);
      expect(montoCarlos).toBe(3500000); // $35.000
    });

    it('4 personas, $120.000: Ana propio $45.000 → Beto, Carlos y Dani $25.000 c/u', () => {
      const montoBeto = montoIgualCentavos(7500000, 3);
      expect(montoBeto).toBe(2500000); // $25.000

      const montoCarlos = montoIgualCentavos(5000000, 2);
      expect(montoCarlos).toBe(2500000); // $25.000

      const montoDani = montoIgualCentavos(2500000, 1);
      expect(montoDani).toBe(2500000); // $25.000
    });

    it('4 personas, $120.000: Ana propio $10.000 → Beto $36.667 → Carlos $36.667 → Dani $36.666', () => {
      const montoBeto = montoIgualCentavos(11000000, 3);
      expect(montoBeto).toBe(3666700); // $36.667

      const montoCarlos = montoIgualCentavos(7333300, 2);
      expect(montoCarlos).toBe(3666700); // $36.667

      const montoDani = montoIgualCentavos(3666600, 1);
      expect(montoDani).toBe(3666600); // $36.666
    });

    it('3 personas, $100.000, todos igual: $33.333 → $33.334 → $33.333', () => {
      const montoAna = montoIgualCentavos(10000000, 3);
      expect(montoAna).toBe(3333300); // $33.333

      const montoBeto = montoIgualCentavos(6666700, 2);
      expect(montoBeto).toBe(3333400); // $33.334

      const montoCarlos = montoIgualCentavos(3333300, 1);
      expect(montoCarlos).toBe(3333300); // $33.333
    });

    it('saldo 0 → 0', () => {
      expect(montoIgualCentavos(0, 3)).toBe(0);
      expect(montoIgualCentavos(-500, 3)).toBe(0);
    });

    it('queda uno solo → paga el saldo exacto (con centavos)', () => {
      expect(montoIgualCentavos(2066650, 1)).toBe(2066650);
      expect(montoIgualCentavos(12345, 1)).toBe(12345);
    });
  });

  describe('montosPorModo', () => {
    it('calcula propio, igual y total usando { presencia, yo }', () => {
      const cuenta = {
        total: 100000,
        pagado: 30000,
        saldo: 70000,
        mia: { saldo: 35000 },
        comensales: [
          { nombre: 'Ana', esGeneral: false },
          { nombre: 'Beto', esGeneral: false },
          { nombre: 'Carlos', esGeneral: false },
        ],
      };
      const presencia = {
        comensales: ['Ana', 'Beto', 'Carlos'],
        pagaron: ['Ana'],
        total: 3,
      };

      const montos = montosPorModo(cuenta, { presencia, yo: 'Beto' });
      expect(montos.propio).toBe(35000);
      expect(montos.igual).toBe(35000); // 70000 / 2
      expect(montos.total).toBe(70000);
    });

    it('calcula con número de personas directo (compatibilidad)', () => {
      const cuenta = {
        total: 62000,
        pagado: 0,
        saldo: 62000,
        mia: { saldo: 20000 },
      };

      const montos = montosPorModo(cuenta, 3);
      expect(montos.igual).toBe(20667);
      expect(montos.total).toBe(62000);
    });

    it('si el saldo de la mesa es 0, todos los modos devuelven 0', () => {
      const cuenta = {
        total: 50000,
        pagado: 50000,
        saldo: 0,
        mia: { saldo: 0 },
      };

      const montos = montosPorModo(cuenta, { yo: 'Ana' });
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

  describe('estadoCuentaSolicitada', () => {
    it('devuelve estado inicial cuando no hay resultado', () => {
      expect(estadoCuentaSolicitada(null)).toEqual(ESTADO_CUENTA_INICIAL);
      expect(estadoCuentaSolicitada(undefined)).toEqual(ESTADO_CUENTA_INICIAL);
    });

    it('devuelve estado enviando al pasar "enviando"', () => {
      expect(estadoCuentaSolicitada('enviando')).toEqual(ESTADO_CUENTA_ENVIANDO);
    });

    it('devuelve estado ok al recibir ack { ok: true }', () => {
      const res = estadoCuentaSolicitada({ ok: true });
      expect(res.estado).toBe('ok');
      expect(res.mensaje).toBe('Ya le avisamos al mesero que quieres la cuenta');
      expect(res.deshabilitado).toBe(true);
      expect(res.tipo).toBe('exito');
    });

    it('devuelve estado ok al recibir ack exitoso con eventId', () => {
      const res = estadoCuentaSolicitada({ ok: true, eventId: '123' });
      expect(res.estado).toBe('ok');
    });

    it('detecta RATE_LIMIT en el error o mensaje', () => {
      const errObj = { codigo: 'RATE_LIMIT', message: 'RATE_LIMIT' };
      const res = estadoCuentaSolicitada(errObj, true);
      expect(res.estado).toBe('rate_limit');
      expect(res.mensaje).toBe('La mesa ya pidió la cuenta; espera un momento');
      expect(res.deshabilitado).toBe(true);
      expect(res.tipo).toBe('advertencia');

      const errConTexto = new Error('Hubo RATE_LIMIT en la sala');
      expect(estadoCuentaSolicitada(errConTexto, true).estado).toBe('rate_limit');
    });

    it('devuelve estado error y habilita el botón ante fallos de conexión', () => {
      const err = new Error('Timeout al esperar ack');
      const res = estadoCuentaSolicitada(err, true);
      expect(res.estado).toBe('error');
      expect(res.mensaje).toBe('No pudimos avisar al mesero. Toca para reintentar.');
      expect(res.deshabilitado).toBe(false);
      expect(res.tipo).toBe('error');
    });

    it('devuelve estado error si el ack trae ok: false', () => {
      const ackFallo = { ok: false, codigo: 'ERROR_INTERNO' };
      const res = estadoCuentaSolicitada(ackFallo, false);
      expect(res.estado).toBe('error');
      expect(res.deshabilitado).toBe(false);
    });
  });

  describe('textoCajaSegunEstado', () => {
    it('devuelve el texto adecuado según el estado del aviso', () => {
      expect(textoCajaSegunEstado({ estado: 'enviando' })).toBe(
        'Avisando al mesero que pagarás en la caja...'
      );
      expect(textoCajaSegunEstado({ estado: 'ok' })).toBe(
        'Ya le avisamos al mesero. Puedes acercarte a la caja o esperarlo en la mesa.'
      );
      expect(textoCajaSegunEstado({ estado: 'rate_limit' })).toBe(
        'La mesa ya pidió la cuenta. Puedes acercarte a la caja o esperar al mesero.'
      );
      expect(textoCajaSegunEstado({ estado: 'error' })).toBe(
        'No pudimos avisar al mesero. Puedes acercarte directamente a la caja a pagar.'
      );
      expect(textoCajaSegunEstado(null)).toBe(
        'Puedes acercarte a la caja a pagar o esperar al mesero en la mesa.'
      );
    });
  });

  describe('avisoPedidoGrupal (J-15)', () => {
    const cuentaBase = {
      mia: { saldo: 46000, subtotal: 46000 },
      saldo: 46000,
      comensales: [
        { nombre: 'Ana', subtotal: 46000, saldo: 46000 },
      ],
    };

    it('modo distinto de propio → null', () => {
      const presencia = { comensales: ['Ana', 'Beto'], sin_celular: [] };
      expect(
        avisoPedidoGrupal({ cuenta: cuentaBase, presencia, yo: 'Ana', modo: 'igual' })
      ).toBeNull();
      expect(
        avisoPedidoGrupal({ cuenta: cuentaBase, presencia, yo: 'Ana', modo: 'total' })
      ).toBeNull();
    });

    it('mi saldo 0 → null', () => {
      const cuentaSinSaldo = {
        mia: { saldo: 0, subtotal: 20000 },
        saldo: 30000,
        comensales: [{ nombre: 'Ana', subtotal: 20000, saldo: 0 }],
      };
      const presencia = { comensales: ['Ana', 'Beto'], sin_celular: [] };
      expect(
        avisoPedidoGrupal({ cuenta: cuentaSinSaldo, presencia, yo: 'Ana', modo: 'propio' })
      ).toBeNull();
    });

    it('solo yo en la mesa → null', () => {
      const presencia = { comensales: ['Ana'], sin_celular: [] };
      expect(
        avisoPedidoGrupal({ cuenta: cuentaBase, presencia, yo: 'Ana', modo: 'propio' })
      ).toBeNull();
    });

    it('alguien presente sin platos → específico con su nombre', () => {
      const presencia = { comensales: ['Ana', 'Beto'], sin_celular: [] };
      const res = avisoPedidoGrupal({
        cuenta: cuentaBase,
        presencia,
        yo: 'Ana',
        modo: 'propio',
      });

      expect(res).not.toBeNull();
      expect(res.tipo).toBe('especifico');
      expect(res.nombres).toEqual(['Beto']);
      expect(res.mensaje).toBe(
        'Beto no tiene nada a su nombre. Si tú pediste por él o ella, puedes dividir o pagar toda la mesa.'
      );
    });

    it('alguien con subtotal 0 → específico', () => {
      const cuentaConBetoCero = {
        mia: { saldo: 46000, subtotal: 46000 },
        comensales: [
          { nombre: 'Ana', subtotal: 46000, saldo: 46000 },
          { nombre: 'Beto', subtotal: 0, saldo: 0 },
        ],
      };
      const presencia = { comensales: ['Ana', 'Beto'], sin_celular: [] };
      const res = avisoPedidoGrupal({
        cuenta: cuentaConBetoCero,
        presencia,
        yo: 'Ana',
        modo: 'propio',
      });

      expect(res).not.toBeNull();
      expect(res.tipo).toBe('especifico');
      expect(res.nombres).toEqual(['Beto']);
      expect(res.mensaje).toContain('Beto no tiene nada a su nombre');
    });

    it('varios sin pedidos (plural y "y N más")', () => {
      // 2 sin pedidos
      const presencia2 = { comensales: ['Ana', 'Beto', 'Carla'], sin_celular: [] };
      const res2 = avisoPedidoGrupal({
        cuenta: cuentaBase,
        presencia: presencia2,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(res2.tipo).toBe('especifico');
      expect(res2.nombres).toEqual(['Beto', 'Carla']);
      expect(res2.mensaje).toBe(
        'Beto y Carla no tienen nada a su nombre. Si tú pediste por ellos o ellas, puedes dividir o pagar toda la mesa.'
      );

      // 4 sin pedidos: máximo 3 y "y 1 más"
      const presencia4 = {
        comensales: ['Ana', 'Beto', 'Carla', 'Dani', 'Elena'],
        sin_celular: [],
      };
      const res4 = avisoPedidoGrupal({
        cuenta: cuentaBase,
        presencia: presencia4,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(res4.tipo).toBe('especifico');
      expect(res4.nombres).toEqual(['Beto', 'Carla', 'Dani', 'y 1 más']);
      expect(res4.mensaje).toBe(
        'Beto, Carla, Dani y 1 más no tienen nada a su nombre. Si tú pediste por ellos o ellas, puedes dividir o pagar toda la mesa.'
      );

      // 5 sin pedidos: "y 2 más"
      const presencia5 = {
        comensales: ['Ana', 'Beto', 'Carla', 'Dani', 'Elena', 'Fabi'],
        sin_celular: [],
      };
      const res5 = avisoPedidoGrupal({
        cuenta: cuentaBase,
        presencia: presencia5,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(res5.nombres).toEqual(['Beto', 'Carla', 'Dani', 'y 2 más']);
      expect(res5.mensaje).toContain('y 2 más no tienen nada a su nombre');
    });

    it('todos con platos → general', () => {
      const cuentaTodos = {
        mia: { saldo: 20000, subtotal: 20000 },
        comensales: [
          { nombre: 'Ana', subtotal: 20000, saldo: 20000 },
          { nombre: 'Beto', subtotal: 26000, saldo: 26000 },
        ],
      };
      const presencia = { comensales: ['Ana', 'Beto'], sin_celular: [] };
      const res = avisoPedidoGrupal({
        cuenta: cuentaTodos,
        presencia,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(res).not.toBeNull();
      expect(res.tipo).toBe('general');
      expect(res.nombres).toEqual([]);
      expect(res.mensaje).toBe(
        '¿Pediste para otros? Usa DIVIDIR o TODA LA MESA.'
      );
    });

    it('"General" nunca cuenta como persona', () => {
      const cuentaConGeneral = {
        mia: { saldo: 20000, subtotal: 20000 },
        comensales: [
          { nombre: 'Ana', subtotal: 20000, saldo: 20000 },
          { nombre: 'General', subtotal: 10000, saldo: 10000 },
        ],
      };
      // Sin nadie más que Ana y General
      const res = avisoPedidoGrupal({
        cuenta: cuentaConGeneral,
        presencia: null,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(res).toBeNull();

      // En presencia tampoco cuenta si viniera "General"
      const presenciaGeneral = { comensales: ['Ana', 'General'], sin_celular: [] };
      const resPresencia = avisoPedidoGrupal({
        cuenta: cuentaConGeneral,
        presencia: presenciaGeneral,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(resPresencia).toBeNull();
    });

    it('sin presencia → usa solo la cuenta y da general', () => {
      const cuentaConBeto = {
        mia: { saldo: 20000, subtotal: 20000 },
        comensales: [
          { nombre: 'Ana', subtotal: 20000, saldo: 20000 },
          { nombre: 'Beto', subtotal: 26000, saldo: 26000 },
        ],
      };
      const res = avisoPedidoGrupal({
        cuenta: cuentaConBeto,
        presencia: null,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(res).not.toBeNull();
      expect(res.tipo).toBe('general');
      expect(res.mensaje).toBe(
        '¿Pediste para otros? Usa DIVIDIR o TODA LA MESA.'
      );
    });

    it('yo nunca aparezco en nombres', () => {
      const presencia = { comensales: ['Ana', 'Beto'], sin_celular: [] };
      const res = avisoPedidoGrupal({
        cuenta: cuentaBase,
        presencia,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(res.nombres).not.toContain('Ana');
      expect(res.mensaje).not.toContain('Ana');
    });

    it('incluye personas en sin_celular de la presencia', () => {
      const presenciaSinCel = { comensales: ['Ana'], sin_celular: ['Carlos'] };
      const res = avisoPedidoGrupal({
        cuenta: cuentaBase,
        presencia: presenciaSinCel,
        yo: 'Ana',
        modo: 'propio',
      });
      expect(res.tipo).toBe('especifico');
      expect(res.nombres).toEqual(['Carlos']);
      expect(res.mensaje).toContain('Carlos no tiene nada a su nombre');
    });
  });

  describe('debeMostrarSugerenciaSinCelular (J-15)', () => {
    it('muestra la sugerencia si hay saldo pendiente en la mesa', () => {
      expect(debeMostrarSugerenciaSinCelular({ saldo: 46000 })).toBe(true);
      expect(debeMostrarSugerenciaSinCelular({ saldo: 1 })).toBe(true);
    });

    it('no se muestra si el saldo de la mesa es 0 o negativo', () => {
      expect(debeMostrarSugerenciaSinCelular({ saldo: 0, mia: { saldo: 0 } })).toBe(false);
      expect(debeMostrarSugerenciaSinCelular({ saldo: -500 })).toBe(false);
      expect(debeMostrarSugerenciaSinCelular(null)).toBe(false);
      expect(debeMostrarSugerenciaSinCelular({})).toBe(false);
    });

    it('el texto exacto coincide con la especificación', () => {
      expect(TEXTO_SUGERENCIA_SIN_CELULAR).toBe(
        '¿Alguien no tiene celular? Pídele al mesero que lo agregue a la mesa.'
      );
    });
  });

  describe('debeSalirDeEspera (J-15)', () => {
    it('bajó el saldo → true', () => {
      expect(debeSalirDeEspera({ saldoAntes: 50000, saldoAhora: 30000 })).toBe(true);
      expect(debeSalirDeEspera({ saldoAntes: 10000, saldoAhora: 0 })).toBe(true);
    });

    it('saldo igual → false', () => {
      expect(debeSalirDeEspera({ saldoAntes: 50000, saldoAhora: 50000 })).toBe(false);
      expect(debeSalirDeEspera({ saldoAntes: 0, saldoAhora: 0 })).toBe(false);
    });

    it('saldo subió → false', () => {
      expect(debeSalirDeEspera({ saldoAntes: 50000, saldoAhora: 60000 })).toBe(false);
    });

    it('datos faltantes o inválidos → false', () => {
      expect(debeSalirDeEspera({ saldoAntes: null, saldoAhora: 30000 })).toBe(false);
      expect(debeSalirDeEspera({ saldoAntes: 50000, saldoAhora: null })).toBe(false);
      expect(debeSalirDeEspera({ saldoAntes: undefined, saldoAhora: 30000 })).toBe(false);
      expect(debeSalirDeEspera({ saldoAntes: 50000, saldoAhora: undefined })).toBe(false);
      expect(debeSalirDeEspera({ saldoAntes: NaN, saldoAhora: 30000 })).toBe(false);
      expect(debeSalirDeEspera({ saldoAntes: '50000', saldoAhora: 30000 })).toBe(false);
      expect(debeSalirDeEspera({})).toBe(false);
      expect(debeSalirDeEspera()).toBe(false);
    });
  });

  describe('mensajePagoConfirmado (J-15)', () => {
    it('comensal coincide con el usuario actual → "propio"', () => {
      expect(mensajePagoConfirmado({ comensal: 'Ana', yo: 'Ana' })).toBe('propio');
      expect(mensajePagoConfirmado({ comensal: 'ana', yo: 'Ana' })).toBe('propio');
      expect(mensajePagoConfirmado({ comensal: '  Ana  ', yo: 'ana' })).toBe('propio');
    });

    it('comensal es null, undefined o vacío (cobro de caja de la mesa) → "mesa"', () => {
      expect(mensajePagoConfirmado({ comensal: null, yo: 'Ana' })).toBe('mesa');
      expect(mensajePagoConfirmado({ comensal: undefined, yo: 'Ana' })).toBe('mesa');
      expect(mensajePagoConfirmado({ comensal: '', yo: 'Ana' })).toBe('mesa');
      expect(mensajePagoConfirmado({ comensal: null, yo: null })).toBe('mesa');
      expect(mensajePagoConfirmado({})).toBe('mesa');
      expect(mensajePagoConfirmado()).toBe('mesa');
    });

    it('comensal es otra persona → "otro"', () => {
      expect(mensajePagoConfirmado({ comensal: 'Beto', yo: 'Ana' })).toBe('otro');
      expect(mensajePagoConfirmado({ comensal: 'Carlos', yo: 'Beto' })).toBe('otro');
      expect(mensajePagoConfirmado({ comensal: 'Beto', yo: null })).toBe('otro');
      expect(mensajePagoConfirmado({ comensal: 'Beto', yo: 'Ana', saldoRestante: 15000 })).toBe('otro');
    });

    it('comensal es otra persona pero saldoRestante es 0 → "mesa"', () => {
      expect(mensajePagoConfirmado({ comensal: 'Beto', yo: 'Ana', saldoRestante: 0 })).toBe('mesa');
      expect(mensajePagoConfirmado({ comensal: 'Carlos', yo: 'Ana', saldoRestante: 0 })).toBe('mesa');
    });

    it('sin evento propio y saldo 0 → "mesa"', () => {
      expect(mensajePagoConfirmado({ comensal: null, yo: 'Ana', saldoRestante: 0 })).toBe('mesa');
      expect(mensajePagoConfirmado({ comensal: null, yo: null, saldoRestante: 0 })).toBe('mesa');
    });
  });

  describe('textoDetalleConfirmacion (J-15)', () => {
    it('tipo "propio" → esPropio true, monto formateado y comprobante Wompi', () => {
      const res = textoDetalleConfirmacion({ tipo: 'propio', monto: 46000 });
      expect(res.esPropio).toBe(true);
      expect(res.mensaje).toBe('Pagaste $ 46.000.');
      expect(res.comprobante).toBe('Te llegará el comprobante de Wompi.');
    });

    it('tipo "mesa" → esPropio false, "La mesa quedó pagada." y sin comprobante', () => {
      const res = textoDetalleConfirmacion({ tipo: 'mesa', monto: 46000 });
      expect(res.esPropio).toBe(false);
      expect(res.mensaje).toBe('La mesa quedó pagada.');
      expect(res.comprobante).toBeNull();
    });

    it('cualquier otro caso ("otro", null, undefined) → "La mesa quedó pagada."', () => {
      expect(textoDetalleConfirmacion({ tipo: 'otro' })).toEqual({
        esPropio: false,
        mensaje: 'La mesa quedó pagada.',
        comprobante: null,
      });
      expect(textoDetalleConfirmacion({})).toEqual({
        esPropio: false,
        mensaje: 'La mesa quedó pagada.',
        comprobante: null,
      });
      expect(textoDetalleConfirmacion()).toEqual({
        esPropio: false,
        mensaje: 'La mesa quedó pagada.',
        comprobante: null,
      });
    });
  });

  describe('eventIdParaIntento (J-15)', () => {
    const generar = () => 'nuevo-uuid-456';

    it('mismo modo y saldo → reutiliza', () => {
      const previo = { eventId: 'previo-uuid-123', modo: 'propio', saldo: 50000 };
      expect(
        eventIdParaIntento(previo, { modo: 'propio', saldo: 50000 }, generar)
      ).toBe('previo-uuid-123');
    });

    it('cambia modo → nuevo', () => {
      const previo = { eventId: 'previo-uuid-123', modo: 'propio', saldo: 50000 };
      expect(
        eventIdParaIntento(previo, { modo: 'igual', saldo: 50000 }, generar)
      ).toBe('nuevo-uuid-456');
    });

    it('cambia saldo → nuevo', () => {
      const previo = { eventId: 'previo-uuid-123', modo: 'propio', saldo: 50000 };
      expect(
        eventIdParaIntento(previo, { modo: 'propio', saldo: 35000 }, generar)
      ).toBe('nuevo-uuid-456');
    });

    it('sin previo → nuevo', () => {
      expect(
        eventIdParaIntento(null, { modo: 'propio', saldo: 50000 }, generar)
      ).toBe('nuevo-uuid-456');
      expect(
        eventIdParaIntento(undefined, { modo: 'propio', saldo: 50000 }, generar)
      ).toBe('nuevo-uuid-456');
    });

    it('pago anterior confirmado → nuevo', () => {
      const previo = { eventId: 'previo-uuid-123', modo: 'propio', saldo: 50000, confirmado: true };
      expect(
        eventIdParaIntento(previo, { modo: 'propio', saldo: 50000 }, generar)
      ).toBe('nuevo-uuid-456');
    });
  });

  describe('estadoSelectorPago (J-15)', () => {
    it('sin fila en la cuenta (nunca pedí nada): selector visible, lo mío deshabilitado, arranca en igual y no yaPague', () => {
      const res = estadoSelectorPago({ saldoMesa: 50000, miSaldo: 0, miPagado: 0 });
      expect(res).toEqual({
        mostrarSelector: true,
        loMioHabilitado: false,
        modoInicial: 'igual',
        yaPague: false,
      });
    });

    it('saldo propio > 0: selector visible, lo mío habilitado, arranca en propio y no yaPague', () => {
      const res = estadoSelectorPago({ saldoMesa: 50000, miSaldo: 20000, miPagado: 0 });
      expect(res).toEqual({
        mostrarSelector: true,
        loMioHabilitado: true,
        modoInicial: 'propio',
        yaPague: false,
      });
    });

    it('ya pagué lo mío con la mesa debiendo: selector visible para ayudar, lo mío deshabilitado, arranca en igual y yaPague true', () => {
      const res = estadoSelectorPago({ saldoMesa: 30000, miSaldo: 0, miPagado: 20000 });
      expect(res).toEqual({
        mostrarSelector: true,
        loMioHabilitado: false,
        modoInicial: 'igual',
        yaPague: true,
      });
    });

    it('ya pagué lo mío con la mesa en 0: selector oculto, lo mío deshabilitado, yaPague true', () => {
      const res = estadoSelectorPago({ saldoMesa: 0, miSaldo: 0, miPagado: 20000 });
      expect(res).toEqual({
        mostrarSelector: false,
        loMioHabilitado: false,
        modoInicial: 'igual',
        yaPague: true,
      });
    });

    it('mesa en 0 sin consumos ni pagos: selector oculto, lo mío deshabilitado, yaPague false', () => {
      const res = estadoSelectorPago({ saldoMesa: 0, miSaldo: 0, miPagado: 0 });
      expect(res).toEqual({
        mostrarSelector: false,
        loMioHabilitado: false,
        modoInicial: 'igual',
        yaPague: false,
      });
    });
  });

  describe('infoTuParte (J-15)', () => {
    it('yaPague true: $0 en verde y "Ya pagaste lo tuyo. ¡Gracias!"', () => {
      const res = infoTuParte({
        miSaldo: 0,
        miPagado: 25000,
        miSubtotal: 25000,
        yaPague: true,
      });
      expect(res).toEqual({
        color: '#2FA35A',
        esVerde: true,
        mensaje: 'Ya pagaste lo tuyo. ¡Gracias!',
      });
    });

    it('sin consumos propios (miSaldo 0 y miPagado 0): color blanco y texto exacto para aportar', () => {
      const res = infoTuParte({
        miSaldo: 0,
        miPagado: 0,
        miSubtotal: 0,
        yaPague: false,
      });
      expect(res).toEqual({
        color: '#FFFFFF',
        esVerde: false,
        mensaje: 'No tienes nada a tu nombre. Puedes aportar con DIVIDIR o TODA LA MESA.',
      });
    });

    it('con saldo pendiente (miSaldo > 0): color blanco y texto Consumiste $X', () => {
      const res = infoTuParte({
        miSaldo: 18000,
        miPagado: 0,
        miSubtotal: 18000,
        yaPague: false,
      });
      expect(res).toEqual({
        color: '#FFFFFF',
        esVerde: false,
        mensaje: 'Consumiste $ 18.000',
      });
    });
  });
});
