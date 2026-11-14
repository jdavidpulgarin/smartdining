import { describe, it, expect } from 'vitest';
import {
  formatoPesos,
  MODOS_PAGO,
  TITULOS_MODO,
  contarPersonasMesa,
  normalizarCuenta,
  montosPorModo,
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
  montoTuParte,
  transicionPantallaPago,
  decidirSalidaEspera,
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
    it('calcula propio y total correctamente', () => {
      const cuenta = {
        total: 100000,
        pagado: 30000,
        saldo: 70000,
        mia: { saldo: 35000 },
      };

      const montos = montosPorModo(cuenta);
      expect(montos.propio).toBe(35000);
      expect(montos.total).toBe(70000);
      expect(montos.igual).toBeUndefined();
    });

    it('propio no supera el saldo de la mesa', () => {
      const cuenta = {
        total: 50000,
        pagado: 40000,
        saldo: 10000,
        mia: { saldo: 25000 },
      };

      const montos = montosPorModo(cuenta);
      expect(montos.propio).toBe(10000);
      expect(montos.total).toBe(10000);
    });

    it('si el saldo de la mesa es 0, todos los modos devuelven 0', () => {
      const cuenta = {
        total: 50000,
        pagado: 50000,
        saldo: 0,
        mia: { saldo: 0 },
      };

      const montos = montosPorModo(cuenta);
      expect(montos.propio).toBe(0);
      expect(montos.total).toBe(0);
      expect(montos.igual).toBeUndefined();
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
        avisoPedidoGrupal({ cuenta: cuentaBase, presencia, yo: 'Ana', modo: 'total' })
      ).toBeNull();
      expect(
        avisoPedidoGrupal({ cuenta: cuentaBase, presencia, yo: 'Ana', modo: 'otro' })
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
        'Beto no tiene nada a su nombre. Si tú pediste por él o ella, puedes pagar toda la cuenta.'
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
        'Beto y Carla no tienen nada a su nombre. Si tú pediste por ellos o ellas, puedes pagar toda la cuenta.'
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
        'Beto, Carla, Dani y 1 más no tienen nada a su nombre. Si tú pediste por ellos o ellas, puedes pagar toda la cuenta.'
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
        '¿Pediste para otros? Puedes pagar toda la cuenta.'
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
        '¿Pediste para otros? Puedes pagar toda la cuenta.'
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
        eventIdParaIntento(previo, { modo: 'total', saldo: 50000 }, generar)
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

  describe('estadoSelectorPago y modos de pago (T2)', () => {
    it('MODOS_PAGO solo contiene propio y total, y TITULOS_MODO tiene los textos exactos', () => {
      expect(MODOS_PAGO).toEqual(['propio', 'total']);
      expect(TITULOS_MODO).toEqual({
        propio: 'Pagar lo mío',
        total: 'Pagar toda la cuenta',
      });
      expect(TITULOS_MODO.igual).toBeUndefined();
    });

    it('mesa con 3 personas → 2 opciones con montos correctos', () => {
      const cuenta = {
        saldo: 60000,
        mia: { saldo: 20000 },
      };
      const presencia = {
        comensales: ['Ana', 'Beto', 'Carlos'],
        sin_celular: [],
      };
      const res = estadoSelectorPago({
        saldoMesa: cuenta.saldo,
        miSaldo: cuenta.mia.saldo,
        miPagado: 0,
        presencia,
        cuenta,
      });

      expect(res.mostrarSelector).toBe(true);
      expect(res.modosDisponibles).toEqual(['propio', 'total']);
      expect(res.modoInicial).toBe('propio');
      expect(res.modo).toBe('propio');

      const montos = montosPorModo(cuenta);
      expect(montos.propio).toBe(20000);
      expect(montos.total).toBe(60000);
      expect(montos.igual).toBeUndefined();
    });

    it('1 persona → un botón y modo total con texto "Pagar la cuenta"', () => {
      const cuenta = {
        saldo: 30000,
        mia: { saldo: 30000 },
      };
      const presencia = {
        comensales: ['Ana'],
        sin_celular: [],
      };
      const res = estadoSelectorPago({
        saldoMesa: cuenta.saldo,
        miSaldo: cuenta.mia.saldo,
        miPagado: 0,
        presencia,
        cuenta,
      });

      expect(res.mostrarSelector).toBe(false);
      expect(res.modo).toBe('total');
      expect(res.modosDisponibles).toEqual(['total']);
      expect(res.textoBoton).toBe('Pagar la cuenta');
      expect(res.texto).toBe('Pagar la cuenta');
    });

    it('mi saldo = saldo de la mesa en mesa de varias personas → mostrarSelector false y modo total "Pagar la cuenta"', () => {
      const cuenta = {
        saldo: 50000,
        mia: { saldo: 50000 },
      };
      const presencia = {
        comensales: ['Ana', 'Beto'],
        sin_celular: [],
      };
      const res = estadoSelectorPago({
        saldoMesa: 50000,
        miSaldo: 50000,
        presencia,
        cuenta,
      });

      expect(res.mostrarSelector).toBe(false);
      expect(res.modo).toBe('total');
      expect(res.modosDisponibles).toEqual(['total']);
      expect(res.textoBoton).toBe('Pagar la cuenta');
    });

    it('2 personas pero lo mío pagado (miSaldo <= 0) → solo total', () => {
      const cuenta = {
        saldo: 30000,
        mia: { saldo: 0, pagado: 20000 },
      };
      const presencia = {
        comensales: ['Ana', 'Beto'],
        pagaron: ['Ana'],
      };
      const res = estadoSelectorPago({
        saldoMesa: 30000,
        miSaldo: 0,
        miPagado: 20000,
        presencia,
        cuenta,
      });

      expect(res.mostrarSelector).toBe(false);
      expect(res.modosDisponibles).toEqual(['total']);
      expect(res.modo).toBe('total');
      expect(res.modosDisponibles).not.toContain('propio');
      expect(res.yaPague).toBe(true);
    });

    it('cuenta sin_celular como persona en la mesa', () => {
      const presenciaConSinCelular = {
        comensales: ['Ana'],
        sin_celular: ['Carlos'],
      };
      expect(contarPersonasMesa({ presencia: presenciaConSinCelular })).toBe(2);

      const res = estadoSelectorPago({
        saldoMesa: 50000,
        miSaldo: 20000,
        presencia: presenciaConSinCelular,
      });
      expect(res.mostrarSelector).toBe(true);
      expect(res.modosDisponibles).toEqual(['propio', 'total']);
    });

    it('sin_celular repetido con comensales no se duplica', () => {
      const presenciaDuplicada = {
        comensales: ['Ana'],
        sin_celular: ['Ana'],
      };
      expect(contarPersonasMesa({ presencia: presenciaDuplicada })).toBe(1);

      const res = estadoSelectorPago({
        saldoMesa: 50000,
        miSaldo: 20000,
        presencia: presenciaDuplicada,
      });
      expect(res.mostrarSelector).toBe(false);
      expect(res.modo).toBe('total');
    });

    it('ningún camino devuelve modo igual', () => {
      const casos = [
        { saldoMesa: 50000, miSaldo: 20000, personas: 3 },
        { saldoMesa: 50000, miSaldo: 50000, personas: 3 },
        { saldoMesa: 50000, miSaldo: 0, personas: 3 },
        { saldoMesa: 50000, miSaldo: 20000, personas: 1 },
        { saldoMesa: 0, miSaldo: 0, personas: 2 },
      ];

      for (const caso of casos) {
        const res = estadoSelectorPago(caso);
        expect(res.modo).not.toBe('igual');
        expect(res.modoInicial).not.toBe('igual');
        expect(res.modosDisponibles).not.toContain('igual');
      }

      const montos = montosPorModo({ saldo: 10000, mia: { saldo: 5000 } });
      expect(montos.igual).toBeUndefined();
      expect(MODOS_PAGO).not.toContain('igual');
      expect(TITULOS_MODO.igual).toBeUndefined();
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
        mensaje: 'No tienes nada a tu nombre. Puedes aportar pagando toda la cuenta.',
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

  describe('montoTuParte (J-15)', () => {
    it('otro pagó y la mesa debe menos que mi saldo → TU PARTE = saldo de la mesa', () => {
      expect(montoTuParte({ saldoMesa: 20000, miSaldo: 46000 })).toBe(20000);
      expect(montoTuParte({ saldoMesa: 15000, miSaldo: 30000 })).toBe(15000);
    });

    it('caso normal (la mesa debe más o igual que mi saldo) → TU PARTE = mi saldo', () => {
      expect(montoTuParte({ saldoMesa: 70000, miSaldo: 46000 })).toBe(46000);
      expect(montoTuParte({ saldoMesa: 46000, miSaldo: 46000 })).toBe(46000);
    });

    it('saldo de la mesa en 0 → 0', () => {
      expect(montoTuParte({ saldoMesa: 0, miSaldo: 46000 })).toBe(0);
    });

    it('comensal sin saldo propio → 0', () => {
      expect(montoTuParte({ saldoMesa: 50000, miSaldo: 0 })).toBe(0);
    });

    it('valores nulos o no numéricos → 0', () => {
      expect(montoTuParte(null)).toBe(0);
      expect(montoTuParte({})).toBe(0);
      expect(montoTuParte({ saldoMesa: 'abc', miSaldo: null })).toBe(0);
    });
  });

  describe('transicionPantallaPago (J-15)', () => {
    it('pago_confirmado propio → pantalla confirmado, apaga espera, limpia y cierra widget', () => {
      const res = transicionPantallaPago({
        tipo: 'pago_confirmado',
        tipoConfirmado: 'propio',
        saldoMesa: 0,
      });
      expect(res).toEqual({
        pantalla: 'confirmado',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      });
    });

    it('pago_confirmado mesa → pantalla confirmado, apaga espera, limpia y cierra widget', () => {
      const res = transicionPantallaPago({
        tipo: 'pago_confirmado',
        tipoConfirmado: 'mesa',
        saldoMesa: 0,
      });
      expect(res).toEqual({
        pantalla: 'confirmado',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      });
    });

    it('pago_confirmado de otro con saldo pendiente → conserva pantalla sin cerrar ni limpiar', () => {
      const res = transicionPantallaPago({
        tipo: 'pago_confirmado',
        tipoConfirmado: 'otro',
        saldoMesa: 20000,
        pantallaActual: 'cuenta',
      });
      expect(res).toEqual({
        pantalla: 'cuenta',
        apagarEspera: false,
        limpiarAlmacenamiento: false,
        cerrarWidget: false,
        errorPago: null,
      });
    });

    it('saldo_cero → pantalla confirmado y apaga espera', () => {
      const res = transicionPantallaPago({ tipo: 'saldo_cero' });
      expect(res).toEqual({
        pantalla: 'confirmado',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      });
    });

    it('salida_espera con saldo 0 → confirmado; con saldo > 0 → cuenta', () => {
      const saldoCero = transicionPantallaPago({ tipo: 'salida_espera', saldoMesa: 0 });
      expect(saldoCero).toEqual({
        pantalla: 'confirmado',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      });

      const saldoPendiente = transicionPantallaPago({ tipo: 'salida_espera', saldoMesa: 24000 });
      expect(saldoPendiente).toEqual({
        pantalla: 'cuenta',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      });
    });

    it('widget_resultado aprobado → espera continua sin cerrar widget', () => {
      const res = transicionPantallaPago({
        tipo: 'widget_resultado',
        resultadoWidget: { transaction: { status: 'APPROVED' } },
      });
      expect(res).toEqual({
        pantalla: 'espera',
        apagarEspera: false,
        limpiarAlmacenamiento: false,
        cerrarWidget: false,
        errorPago: null,
      });
    });

    it('widget_resultado rechazado (DECLINED/ERROR) → vuelve a cuenta con mensaje de error', () => {
      const decl = transicionPantallaPago({
        tipo: 'widget_resultado',
        resultadoWidget: { transaction: { status: 'DECLINED' } },
      });
      expect(decl).toEqual({
        pantalla: 'cuenta',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: 'El pago no fue aprobado. Puedes intentar nuevamente.',
      });

      const err = transicionPantallaPago({
        tipo: 'widget_resultado',
        resultadoWidget: { transaction: { status: 'ERROR' } },
      });
      expect(err).toEqual({
        pantalla: 'cuenta',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: 'El pago no fue aprobado. Puedes intentar nuevamente.',
      });
    });

    it('widget_resultado cerrado sin pagar (null o sin transaccion) → vuelve a cuenta sin error', () => {
      const sinPago = transicionPantallaPago({
        tipo: 'widget_resultado',
        resultadoWidget: null,
      });
      expect(sinPago).toEqual({
        pantalla: 'cuenta',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      });
    });

    it('volver_cuenta → vuelve a cuenta y apaga espera', () => {
      const res = transicionPantallaPago({ tipo: 'volver_cuenta' });
      expect(res).toEqual({
        pantalla: 'cuenta',
        apagarEspera: true,
        limpiarAlmacenamiento: true,
        cerrarWidget: true,
        errorPago: null,
      });
    });
  });

  describe('decidirSalidaEspera (J-15)', () => {
    it('otro paga con mi widget abierto → mantener', () => {
      const res = decidirSalidaEspera({
        origen: 'widget',
        widgetAbierto: true,
        saldoAntes: 70000,
        saldoAhora: 46000,
        tipoEvento: 'pago_otro',
      });
      expect(res).toBe('mantener');
    });

    it('pago propio con widget abierto → confirmado_propio', () => {
      const res = decidirSalidaEspera({
        origen: 'widget',
        widgetAbierto: true,
        saldoAntes: 70000,
        saldoAhora: 24000,
        tipoEvento: 'pago_propio',
      });
      expect(res).toBe('confirmado_propio');
    });

    it('vuelvo de redirección y el saldo bajó a mayor que 0 → salir_a_cuenta', () => {
      const res = decidirSalidaEspera({
        origen: 'redireccion',
        widgetAbierto: false,
        saldoAntes: 70000,
        saldoAhora: 46000,
        tipoEvento: 'salida_espera',
      });
      expect(res).toBe('salir_a_cuenta');
    });

    it('vuelvo de redirección y el saldo bajó a 0 → confirmado_mesa', () => {
      const res = decidirSalidaEspera({
        origen: 'redireccion',
        widgetAbierto: false,
        saldoAntes: 70000,
        saldoAhora: 0,
        tipoEvento: 'salida_espera',
      });
      expect(res).toBe('confirmado_mesa');
    });

    it('vuelvo de redirección y el saldo es igual → mantener', () => {
      const res = decidirSalidaEspera({
        origen: 'redireccion',
        widgetAbierto: false,
        saldoAntes: 70000,
        saldoAhora: 70000,
        tipoEvento: 'salida_espera',
      });
      expect(res).toBe('mantener');
    });

    it('mesa en 0 por otro con mi widget abierto → mantener', () => {
      const porSaldoCero = decidirSalidaEspera({
        origen: 'widget',
        widgetAbierto: true,
        saldoAntes: 70000,
        saldoAhora: 0,
        tipoEvento: 'saldo_cero',
      });
      expect(porSaldoCero).toBe('mantener');

      const porPagoMesa = decidirSalidaEspera({
        origen: 'widget',
        widgetAbierto: true,
        saldoAntes: 70000,
        saldoAhora: 0,
        tipoEvento: 'pago_mesa',
      });
      expect(porPagoMesa).toBe('mantener');
    });

    it('en modo simulado (origen widget) otro paga → mantener', () => {
      const res = decidirSalidaEspera({
        origen: 'widget',
        widgetAbierto: false,
        saldoAntes: 70000,
        saldoAhora: 24000,
        tipoEvento: 'pago_otro',
      });
      expect(res).toBe('mantener');
    });
  });
});
