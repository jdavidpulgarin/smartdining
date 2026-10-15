import { describe, expect, it } from 'vitest';
import { leerMesaDelQr } from './qr';

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
