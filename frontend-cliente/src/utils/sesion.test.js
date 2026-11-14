import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CLAVE_SESION,
  CLAVE_SESION_CERRADA,
  leerExpiracionJwt,
  validarNombre,
  obtenerSesion,
  borrarSesionDeStorages,
  migrarSesionStorage,
  leerSesionAlmacenada,
  decidirDestinoInicio,
  nombreSugerido,
  obtenerSesionCerrada,
  guardarSesionCerrada,
  borrarSesionCerrada,
  esMotivo401,
} from './sesion';

function crearJwtPrueba(payloadObj) {
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payloadObj)}.firma`;
}

describe('validarNombre', () => {
  it('acepta un nombre valido y recorta espacios extremos', () => {
    const res = validarNombre('  Ana Maria  ');
    expect(res).toEqual({
      valido: true,
      nombre: 'Ana Maria',
      error: null,
    });
  });

  it('rechaza nombres de 1 caracter', () => {
    const res = validarNombre('A');
    expect(res.valido).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('rechaza nombres de 41 caracteres', () => {
    const res = validarNombre('a'.repeat(41));
    expect(res.valido).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('rechaza nombres con emojis o caracter @', () => {
    expect(validarNombre('Ana 😊').valido).toBe(false);
    expect(validarNombre('ana@mesa').valido).toBe(false);
  });

  it('acepta nombres con tildes, dieresis, ñ y puntuacion permitida', () => {
    const res = validarNombre("Iñaki Pérez-Gómez D'Artagnan Jr.");
    expect(res.valido).toBe(true);
    expect(res.nombre).toBe("Iñaki Pérez-Gómez D'Artagnan Jr.");
  });

  it('rechaza cadenas con solo espacios o solo signos de puntuacion ("...")', () => {
    expect(validarNombre('     ').valido).toBe(false);
    expect(validarNombre('...').valido).toBe(false);
    expect(validarNombre('---').valido).toBe(false);
  });
});

describe('leerExpiracionJwt', () => {
  it('devuelve los milisegundos de expiracion de un JWT con campo exp', () => {
    const expSegundos = 1893456000;
    const token = crearJwtPrueba({
      id_mesa: 5,
      comensal: 'Ana',
      exp: expSegundos,
    });

    expect(leerExpiracionJwt(token)).toBe(expSegundos * 1000);
  });

  it('devuelve null cuando el token esta roto o no tiene exp numerico', () => {
    expect(leerExpiracionJwt('')).toBeNull();
    expect(leerExpiracionJwt('token-invalido')).toBeNull();
    expect(leerExpiracionJwt('a.%%%invalido%%%.c')).toBeNull();
    expect(crearJwtPrueba({ id_mesa: 5 })).toBeTruthy();
    expect(leerExpiracionJwt(crearJwtPrueba({ id_mesa: 5 }))).toBeNull();
  });
});

function crearMockStorage(inicial = {}) {
  let tabla = { ...inicial };
  return {
    getItem: vi.fn((k) => tabla[k] ?? null),
    setItem: vi.fn((k, v) => {
      tabla[k] = String(v);
    }),
    removeItem: vi.fn((k) => {
      delete tabla[k];
    }),
    clear: vi.fn(() => {
      tabla = {};
    }),
    get _datos() {
      return tabla;
    },
  };
}

describe('persistencia y migracion de sesion en localStorage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('migra sesion desde sessionStorage hacia localStorage si local estaba vacio', () => {
    const sesion = { token: 't1', idMesa: 5, comensal: 'Ana' };
    const mockLocal = crearMockStorage();
    const mockSession = crearMockStorage({ [CLAVE_SESION]: JSON.stringify(sesion) });

    migrarSesionStorage(mockLocal, mockSession);

    expect(mockLocal.setItem).toHaveBeenCalledWith(CLAVE_SESION, JSON.stringify(sesion));
    expect(mockSession.removeItem).toHaveBeenCalledWith(CLAVE_SESION);
    expect(mockLocal._datos[CLAVE_SESION]).toBe(JSON.stringify(sesion));
    expect(mockSession._datos[CLAVE_SESION]).toBeUndefined();
  });

  it('no sobreescribe localStorage si ya tenia una sesion guardada', () => {
    const sesionLocal = { token: 't-local', idMesa: 5 };
    const sesionSession = { token: 't-session', idMesa: 6 };
    const mockLocal = crearMockStorage({ [CLAVE_SESION]: JSON.stringify(sesionLocal) });
    const mockSession = crearMockStorage({ [CLAVE_SESION]: JSON.stringify(sesionSession) });

    migrarSesionStorage(mockLocal, mockSession);

    expect(mockLocal.setItem).not.toHaveBeenCalled();
    expect(mockLocal._datos[CLAVE_SESION]).toBe(JSON.stringify(sesionLocal));
  });

  it('borrarSesionDeStorages borra la clave de ambos storages', () => {
    const mockLocal = crearMockStorage({ [CLAVE_SESION]: 'algo' });
    const mockSession = crearMockStorage({ [CLAVE_SESION]: 'algo' });

    borrarSesionDeStorages(mockLocal, mockSession);

    expect(mockLocal.removeItem).toHaveBeenCalledWith(CLAVE_SESION);
    expect(mockSession.removeItem).toHaveBeenCalledWith(CLAVE_SESION);
    expect(mockLocal._datos[CLAVE_SESION]).toBeUndefined();
    expect(mockSession._datos[CLAVE_SESION]).toBeUndefined();
  });

  it('obtenerSesion lee de localStorage y valida que no este vencido', () => {
    const tokenValido = crearJwtPrueba({ id_mesa: 5, comensal: 'Ana', exp: 2000000000 });
    const sesion = { token: tokenValido, idMesa: 5, comensal: 'Ana' };
    const mockLocal = crearMockStorage({ [CLAVE_SESION]: JSON.stringify(sesion) });
    const mockSession = crearMockStorage();

    const resultado = obtenerSesion(mockLocal, mockSession);
    expect(resultado).toEqual(sesion);
  });

  it('sesion vencida se borra de ambos storages y no se usa', () => {
    const tokenVencido = crearJwtPrueba({ id_mesa: 5, comensal: 'Ana', exp: 1000000 }); // Año 1970
    const sesion = { token: tokenVencido, idMesa: 5, comensal: 'Ana' };
    const mockLocal = crearMockStorage({ [CLAVE_SESION]: JSON.stringify(sesion) });
    const mockSession = crearMockStorage();

    const resultado = obtenerSesion(mockLocal, mockSession);
    expect(resultado).toBeNull();
    expect(mockLocal._datos[CLAVE_SESION]).toBeUndefined();

    // También con leerSesionAlmacenada
    const mockLocal2 = crearMockStorage({ [CLAVE_SESION]: JSON.stringify(sesion) });
    const mockSession2 = crearMockStorage();
    const resAlmacenada = leerSesionAlmacenada(mockLocal2, mockSession2);
    expect(resAlmacenada).toBeNull();
    expect(mockLocal2._datos[CLAVE_SESION]).toBeUndefined();
  });
});

function crearTokenQrPrueba(mesa) {
  const payloadB64 = Buffer.from(JSON.stringify({ m: mesa, iat: Date.now() }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `v1.${payloadB64}.firma`;
}

describe('decidirDestinoInicio', () => {
  const sesionVigenteMesa5 = {
    token: 'jwt.token.valido',
    idMesa: 5,
    numeroMesa: 5,
    comensal: 'Ana',
  };

  it('(sin token + sesión vigente con pedidos activos) -> redirige a /seguimiento', () => {
    const res = decidirDestinoInicio({
      tokenUrl: null,
      sesion: sesionVigenteMesa5,
      tienePedidosActivos: true,
    });
    expect(res).toEqual({ accion: 'redirigir', ruta: '/seguimiento' });
  });

  it('sesión que ya existía al abrir + sin token → redirige', () => {
    const res = decidirDestinoInicio({
      tokenUrl: null,
      sesion: sesionVigenteMesa5,
      tienePedidosActivos: false,
      recienUnido: false,
    });
    expect(res).toEqual({ accion: 'redirigir', ruta: '/menu' });
  });

  it('sesión recién creada (recienUnido) → NO redirige (muestra bienvenida)', () => {
    const res = decidirDestinoInicio({
      tokenUrl: null,
      sesion: sesionVigenteMesa5,
      tienePedidosActivos: false,
      recienUnido: true,
    });
    expect(res).toEqual({ accion: 'bienvenida' });
  });

  it('sin sesión → pantalla normal', () => {
    const res = decidirDestinoInicio({
      tokenUrl: null,
      sesion: null,
      recienUnido: false,
    });
    expect(res).toEqual({ accion: 'sin_sesion' });
  });

  it('(sin token + sesión vigente sin pedidos activos) -> redirige a /menu', () => {
    const res = decidirDestinoInicio({
      tokenUrl: '',
      sesion: sesionVigenteMesa5,
      tienePedidosActivos: false,
    });
    expect(res).toEqual({ accion: 'redirigir', ruta: '/menu' });
  });

  it('(sin token + sin sesión) -> pantalla normal sin_sesion', () => {
    const res = decidirDestinoInicio({
      tokenUrl: null,
      sesion: null,
    });
    expect(res).toEqual({ accion: 'sin_sesion' });
  });

  it('(con token + sin sesión) -> pide_nombre con numero de mesa si es legible', () => {
    const token = crearTokenQrPrueba(5);
    const res = decidirDestinoInicio({
      tokenUrl: token,
      sesion: null,
    });
    expect(res).toEqual({ accion: 'pide_nombre', mesaQr: 5 });
  });

  it('(con token misma mesa + sesión vigente) -> redirige directamente a /menu o /seguimiento', () => {
    const tokenMesa5 = crearTokenQrPrueba(5);
    const res = decidirDestinoInicio({
      tokenUrl: tokenMesa5,
      sesion: sesionVigenteMesa5,
      tienePedidosActivos: false,
    });
    expect(res).toEqual({ accion: 'redirigir', ruta: '/menu', mesaQr: 5 });
  });

  it('(con token de OTRA mesa + sesión vigente) -> unirse_nueva_mesa', () => {
    const tokenMesa8 = crearTokenQrPrueba(8);
    const res = decidirDestinoInicio({
      tokenUrl: tokenMesa8,
      sesion: sesionVigenteMesa5,
      tienePedidosActivos: false,
    });
    expect(res).toEqual({ accion: 'unirse_nueva_mesa', mesaQr: 8 });
  });

  it('(con token opaco sin mesa decodificable + sesión vigente) -> confirmar_reutilizar', () => {
    const res = decidirDestinoInicio({
      tokenUrl: 'token_opaco_sin_v1',
      sesion: sesionVigenteMesa5,
      tienePedidosActivos: false,
    });
    expect(res).toEqual({ accion: 'confirmar_reutilizar', mesaQr: null });
  });
});

describe('nombreSugerido', () => {
  it('agrega sufijo " 2" si el alias no termina en numero', () => {
    expect(nombreSugerido('Juan')).toBe('Juan 2');
    expect(nombreSugerido('Carlos')).toBe('Carlos 2');
    expect(nombreSugerido('Ana Maria')).toBe('Ana Maria 2');
  });

  it('incrementa el numero si el alias ya termina en numero', () => {
    expect(nombreSugerido('Juan 2')).toBe('Juan 3');
    expect(nombreSugerido('Juan 3')).toBe('Juan 4');
    expect(nombreSugerido('Juan 9')).toBe('Juan 10');
    expect(nombreSugerido('Ana Maria 5')).toBe('Ana Maria 6');
  });

  it('retorna cadena vacia si el alias es invalido o vacio', () => {
    expect(nombreSugerido('')).toBe('');
    expect(nombreSugerido('   ')).toBe('');
    expect(nombreSugerido(null)).toBe('');
    expect(nombreSugerido(undefined)).toBe('');
    expect(nombreSugerido(123)).toBe('');
  });
});

describe('guardarSesionCerrada, obtenerSesionCerrada y borrarSesionCerrada', () => {
  it('guarda, lee y borra la marca de sesion cerrada en sessionStorage', () => {
    const mockStorage = {
      data: {},
      getItem(k) {
        return this.data[k] || null;
      },
      setItem(k, v) {
        this.data[k] = String(v);
      },
      removeItem(k) {
        delete this.data[k];
      },
    };

    expect(obtenerSesionCerrada(mockStorage)).toBeNull();

    guardarSesionCerrada('Juan', mockStorage);
    expect(mockStorage.data[CLAVE_SESION_CERRADA]).toBe('Juan');
    expect(obtenerSesionCerrada(mockStorage)).toBe('Juan');

    borrarSesionCerrada(mockStorage);
    expect(mockStorage.data[CLAVE_SESION_CERRADA]).toBeUndefined();
    expect(obtenerSesionCerrada(mockStorage)).toBeNull();
  });
});

describe('esMotivo401', () => {
  it('identifica motivos tipicos de 401 como verdaderos', () => {
    expect(esMotivo401(401)).toBe(true);
    expect(esMotivo401('401')).toBe(true);
    expect(esMotivo401('sesion_invalida')).toBe(true);
    expect(esMotivo401('TOKEN_INVALIDO')).toBe(true);
    expect(esMotivo401('token_invalido')).toBe(true);
    expect(esMotivo401('token_vencido')).toBe(true);
    expect(esMotivo401('expirado')).toBe(true);
    expect(esMotivo401('auth_requerida')).toBe(true);
    expect(esMotivo401('no_autorizado')).toBe(true);
  });

  it('identifica liberacion de mesa, cierre manual o valores nulos como falsos', () => {
    expect(esMotivo401('mesa:liberada')).toBe(false);
    expect(esMotivo401('liberada')).toBe(false);
    expect(esMotivo401('pagada')).toBe(false);
    expect(esMotivo401('MESA_LIBERADA')).toBe(false);
    expect(esMotivo401('manual')).toBe(false);
    expect(esMotivo401(null)).toBe(false);
    expect(esMotivo401(undefined)).toBe(false);
    expect(esMotivo401('')).toBe(false);
  });
});
