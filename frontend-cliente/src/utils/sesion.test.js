import { describe, expect, it } from 'vitest';
import { leerExpiracionJwt, validarNombre } from './sesion';

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
