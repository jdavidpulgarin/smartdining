import { describe, expect, it } from 'vitest';
import {
  leerMesaDelQr,
  validarUrlQrMesa,
  clasificarErrorCamara,
  diagnosticarCamara,
} from './qr';

function crearTokenPrueba(payload, version = 'v1', firma = 'firma_mock') {
  const json = JSON.stringify(payload);
  const base64 = Buffer.from(json, 'utf-8').toString('base64');
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${version}.${base64url}.${firma}`;
}

describe('leerMesaDelQr', () => {
  it('decodifica correctamente la mesa de un token QR v1 válido', () => {
    const token = crearTokenPrueba({ m: 5, sid: 'sesion-123', exp: 999999 });
    expect(leerMesaDelQr(token)).toBe(5);

    const tokenMesa12 = crearTokenPrueba({ m: 12, sid: 's-456' });
    expect(leerMesaDelQr(tokenMesa12)).toBe(12);
  });

  it('devuelve null cuando el token es "simulado"', () => {
    expect(leerMesaDelQr('simulado')).toBeNull();
    expect(leerMesaDelQr('simulado-expirado')).toBeNull();
    expect(leerMesaDelQr('simulado-caido')).toBeNull();
  });

  it('devuelve null con datos basura o formato inválido', () => {
    expect(leerMesaDelQr('')).toBeNull();
    expect(leerMesaDelQr(null)).toBeNull();
    expect(leerMesaDelQr(undefined)).toBeNull();
    expect(leerMesaDelQr(123)).toBeNull();
    expect(leerMesaDelQr('v1')).toBeNull();
    expect(leerMesaDelQr('v1.solo-dos-partes')).toBeNull();
    expect(leerMesaDelQr('v2.algo.firma')).toBeNull();
    expect(leerMesaDelQr('v1.no_es_json_valido.firma')).toBeNull();
  });

  it('devuelve null si el payload no contiene el campo "m"', () => {
    const tokenSinM = crearTokenPrueba({ sid: 'sesion-1', exp: 12345 });
    expect(leerMesaDelQr(tokenSinM)).toBeNull();
  });

  it('devuelve null si "m" no es un entero positivo', () => {
    expect(leerMesaDelQr(crearTokenPrueba({ m: 0 }))).toBeNull();
    expect(leerMesaDelQr(crearTokenPrueba({ m: -3 }))).toBeNull();
    expect(leerMesaDelQr(crearTokenPrueba({ m: 3.5 }))).toBeNull();
    expect(leerMesaDelQr(crearTokenPrueba({ m: '5' }))).toBeNull();
    expect(leerMesaDelQr(crearTokenPrueba({ m: null }))).toBeNull();
  });
});

describe('validarUrlQrMesa', () => {
  const tokenValido = crearTokenPrueba({ m: 5, sid: 'sesion-123', exp: 999999 });

  it('QR real válido → ok con ruta', () => {
    const origen = 'https://app.smartdining.co';
    const url = `${origen}/?token=${tokenValido}`;
    const res = validarUrlQrMesa(url, origen);

    expect(res).toEqual({
      ok: true,
      ruta: `/?token=${tokenValido}`,
    });
  });

  it('otro dominio → no', () => {
    const origen = 'https://app.smartdining.co';
    const urlMaliciosa = `https://sitio-falso.com/?token=${tokenValido}`;
    expect(validarUrlQrMesa(urlMaliciosa, origen)).toEqual({ ok: false });

    const urlSubdominio = `https://otro.smartdining.co/?token=${tokenValido}`;
    expect(validarUrlQrMesa(urlSubdominio, origen)).toEqual({ ok: false });
  });

  it('mismo dominio con otra ruta → no', () => {
    const origen = 'https://app.smartdining.co';
    expect(validarUrlQrMesa(`${origen}/menu?token=${tokenValido}`, origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa(`${origen}/mesa/5?token=${tokenValido}`, origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa(`${origen}/api/mesas?token=${tokenValido}`, origen)).toEqual({ ok: false });
  });

  it('javascript:, data:, //host, texto plano, URL con token mal formado → no', () => {
    const origen = 'https://app.smartdining.co';

    // Protocolos no permitidos y formatos anómalos
    expect(validarUrlQrMesa('javascript:alert(1)', origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa('data:text/html,<b>hola</b>', origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa('//app.smartdining.co/?token=' + tokenValido, origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa('texto plano no url', origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa('', origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa(null, origen)).toEqual({ ok: false });

    // Sin token o token vacío
    expect(validarUrlQrMesa(`${origen}/`, origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa(`${origen}/?token=`, origen)).toEqual({ ok: false });

    // Token mal formado
    expect(validarUrlQrMesa(`${origen}/?token=token_invalido`, origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa(`${origen}/?token=v1.no_es_base64.firma`, origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa(`${origen}/?token=v2.payload.firma`, origen)).toEqual({ ok: false });
    expect(validarUrlQrMesa(`${origen}/?token=v1.solo-dos-partes`, origen)).toEqual({ ok: false });
  });

  it('http en producción → no', () => {
    const origenHttp = 'http://app.smartdining.co';
    const url = `${origenHttp}/?token=${tokenValido}`;
    expect(validarUrlQrMesa(url, origenHttp)).toEqual({ ok: false });

    // Aunque el origen actual sea https, si la URL escaneada viene con http
    const origenHttps = 'https://app.smartdining.co';
    expect(validarUrlQrMesa(`http://app.smartdining.co/?token=${tokenValido}`, origenHttps)).toEqual({ ok: false });
  });

  it('http://localhost en desarrollo → sí', () => {
    const origenDev = 'http://localhost:5174';
    const url = `${origenDev}/?token=${tokenValido}`;
    expect(validarUrlQrMesa(url, origenDev)).toEqual({
      ok: true,
      ruta: `/?token=${tokenValido}`,
    });

    // Con token simulado en localhost
    const urlSim = `${origenDev}/?token=simulado`;
    expect(validarUrlQrMesa(urlSim, origenDev)).toEqual({
      ok: true,
      ruta: '/?token=simulado',
    });

    // En 127.0.0.1 también es desarrollo local
    const origenLoopback = 'http://127.0.0.1:5174';
    const urlLoopback = `${origenLoopback}/?token=${tokenValido}`;
    expect(validarUrlQrMesa(urlLoopback, origenLoopback)).toEqual({
      ok: true,
      ruta: `/?token=${tokenValido}`,
    });
  });

  it('QR válido con parámetros extra (?token=v1...&utm=x&jwt_dev=y) → ruta solo con el token', () => {
    const origen = 'https://app.smartdining.co';
    const urlConExtras = `${origen}/?token=${tokenValido}&utm_source=mesa5&jwt_dev=dev123&otro=param`;
    const res = validarUrlQrMesa(urlConExtras, origen);

    expect(res).toEqual({
      ok: true,
      ruta: `/?token=${tokenValido}`,
    });
  });

  it('QR válido con #fragmento → sin fragmento', () => {
    const origen = 'https://app.smartdining.co';
    const urlConHash = `${origen}/?token=${tokenValido}#seccion-inicio`;
    const res = validarUrlQrMesa(urlConHash, origen);

    expect(res).toEqual({
      ok: true,
      ruta: `/?token=${tokenValido}`,
    });
  });
});

describe('clasificarErrorCamara', () => {
  it('clasifica error sin camara (NotFoundError / OverconstrainedError / sin_camara)', () => {
    const errNotFound = new Error('No camera found');
    errNotFound.name = 'NotFoundError';
    expect(clasificarErrorCamara(errNotFound)).toEqual({
      tipo: 'sin_camara',
      mensaje: 'No encontramos una cámara en este dispositivo.',
    });

    const errOverconstrained = new Error('Constraints not met');
    errOverconstrained.name = 'OverconstrainedError';
    expect(clasificarErrorCamara(errOverconstrained)).toEqual({
      tipo: 'sin_camara',
      mensaje: 'No encontramos una cámara en este dispositivo.',
    });

    expect(clasificarErrorCamara('sin_camara')).toEqual({
      tipo: 'sin_camara',
      mensaje: 'No encontramos una cámara en este dispositivo.',
    });
  });

  it('clasifica error de permiso negado (NotAllowedError / SecurityError / permiso_denegado)', () => {
    const errNotAllowed = new Error('Permission denied');
    errNotAllowed.name = 'NotAllowedError';
    expect(clasificarErrorCamara(errNotAllowed)).toEqual({
      tipo: 'permiso_denegado',
      mensaje: 'Necesitamos permiso para usar la cámara. Actívalo en los ajustes del navegador o del teléfono.',
    });

    const errSecurity = new Error('Security policy');
    errSecurity.name = 'SecurityError';
    expect(clasificarErrorCamara(errSecurity)).toEqual({
      tipo: 'permiso_denegado',
      mensaje: 'Necesitamos permiso para usar la cámara. Actívalo en los ajustes del navegador o del teléfono.',
    });

    expect(clasificarErrorCamara('permiso_denegado')).toEqual({
      tipo: 'permiso_denegado',
      mensaje: 'Necesitamos permiso para usar la cámara. Actívalo en los ajustes del navegador o del teléfono.',
    });
  });

  it('clasifica otros errores como desconocidos con mensaje generico', () => {
    const errGenerico = new Error('Something went wrong');
    expect(clasificarErrorCamara(errGenerico)).toEqual({
      tipo: 'error_desconocido',
      mensaje: 'No pudimos iniciar la cámara. Intenta de nuevo.',
    });

    expect(clasificarErrorCamara(null)).toEqual({
      tipo: 'error_desconocido',
      mensaje: 'No pudimos iniciar la cámara. Intenta de nuevo.',
    });
  });
});

describe('diagnosticarCamara', () => {
  it('permissions "denied" → permiso_denegado (y no llama a getUserMedia)', async () => {
    let llamadoGetUserMedia = false;
    const permissions = {
      query: async ({ name }) => {
        expect(name).toBe('camera');
        return { state: 'denied' };
      },
    };
    const mediaDevices = {
      getUserMedia: async () => {
        llamadoGetUserMedia = true;
        return null;
      },
    };

    const resultado = await diagnosticarCamara({ permissions, mediaDevices });
    expect(resultado).toBe('permiso_denegado');
    expect(llamadoGetUserMedia).toBe(false);
  });

  it('permissions que lanza + getUserMedia con NotAllowedError → permiso_denegado', async () => {
    const permissions = {
      query: async () => {
        throw new Error('Not supported');
      },
    };
    const mediaDevices = {
      getUserMedia: async () => {
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        throw err;
      },
    };

    const resultado = await diagnosticarCamara({ permissions, mediaDevices });
    expect(resultado).toBe('permiso_denegado');
  });

  it('sin Permissions API + NotFoundError → sin_camara', async () => {
    const mediaDevices = {
      getUserMedia: async () => {
        const err = new Error('No device');
        err.name = 'NotFoundError';
        throw err;
      },
    };

    const resultado = await diagnosticarCamara({ permissions: null, mediaDevices });
    expect(resultado).toBe('sin_camara');
  });

  it('getUserMedia ok → "ok" y se detuvieron las pistas', async () => {
    let pistaDetenida = false;
    const mockTrack = {
      stop: () => {
        pistaDetenida = true;
      },
    };
    const mediaDevices = {
      getUserMedia: async () => ({
        getTracks: () => [mockTrack],
      }),
    };

    const resultado = await diagnosticarCamara({ permissions: null, mediaDevices });
    expect(resultado).toBe('ok');
    expect(pistaDetenida).toBe(true);
  });

  it('sin mediaDevices → sin_camara', async () => {
    const resultado = await diagnosticarCamara({ permissions: null, mediaDevices: null });
    expect(resultado).toBe('sin_camara');
  });

  it('caso Roberto: la librería lanza "Camera not found." pero el permiso está negado → se muestra el mensaje de Ajustes (permiso_denegado), no el genérico', async () => {
    // Cuando el permiso está denegado, diagnosticarCamara detecta 'permiso_denegado'
    const permissions = {
      query: async () => ({ state: 'denied' }),
    };
    const mediaDevices = {
      getUserMedia: async () => {
        const err = new Error('Camera not found.');
        err.name = 'NotAllowedError';
        throw err;
      },
    };

    const diag = await diagnosticarCamara({ permissions, mediaDevices });
    expect(diag).toBe('permiso_denegado');

    // Al clasificar el resultado del diagnóstico, se obtiene el mensaje de ajustes y no el genérico
    const errObj = clasificarErrorCamara(diag);
    expect(errObj.tipo).toBe('permiso_denegado');
    expect(errObj.mensaje.toLowerCase()).toContain('ajustes');
    expect(errObj.mensaje).not.toBe('No pudimos iniciar la cámara. Intenta de nuevo.');
  });
});
