import { describe, expect, it } from 'vitest';
import { resolverApodo } from './apodo';

function crearJwtConAlias(alias) {
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ id_mesa: 5, rol: 'comensal', comensal: alias });
  return `${header}.${payload}.firma`;
}

describe('resolverApodo', () => {
  it('prioriza SIEMPRE el alias del JWT sobre el texto escrito por el usuario en comensal', () => {
    const tokenAna = crearJwtConAlias('Ana');
    const sesion = {
      token: tokenAna,
      comensal: 'Juan', // Usuario escribió "Juan" en la pantalla de bienvenida
    };

    expect(resolverApodo(sesion)).toBe('Ana');
  });

  it('devuelve el alias del JWT aunque comensal esté vacío o ausente', () => {
    const tokenBeto = crearJwtConAlias('Beto');
    expect(resolverApodo({ token: tokenBeto })).toBe('Beto');
    expect(resolverApodo({ token: tokenBeto, comensal: '' })).toBe('Beto');
  });

  it('usa sesion.comensal si el token no tiene alias firmado o no es un JWT válido', () => {
    expect(resolverApodo({ token: 'simulado', comensal: 'Carlos' })).toBe('Carlos');
    expect(resolverApodo({ comensal: 'Diana' })).toBe('Diana');
  });

  it('devuelve string vacío si la sesión es null o no tiene nombre', () => {
    expect(resolverApodo(null)).toBe('');
    expect(resolverApodo(undefined)).toBe('');
    expect(resolverApodo({})).toBe('');
  });
});
