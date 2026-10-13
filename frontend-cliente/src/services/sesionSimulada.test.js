import { describe, expect, it } from 'vitest';
import { crearSesionSimulada } from './sesionSimulada';
import { leerExpiracionJwt } from '../utils/sesion';

describe('crearSesionSimulada', () => {
  it('responde 201 simulado con mesa 5, el comensal y un JWT con exp valido', async () => {
    const respuesta = await crearSesionSimulada('simulado', 'Ana');

    expect(respuesta.comensal).toBe('Ana');
    expect(respuesta.mesa).toEqual({
      id_mesa: 5,
      numero: 5,
      capacidad: 4,
      ubicacion: 'Terraza',
      estado: 'ocupada',
    });
    expect(typeof respuesta.token).toBe('string');
    const expMs = leerExpiracionJwt(respuesta.token);
    expect(expMs).toBeGreaterThan(Date.now());
  });

  it('lanza error 409 alias_en_uso cuando el comensal es "Ocupado" (sin importar mayusculas)', async () => {
    await expect(
      crearSesionSimulada('simulado', 'Ocupado')
    ).rejects.toMatchObject({
      status: 409,
      motivo: 'alias_en_uso',
      mensaje: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
    });

    await expect(
      crearSesionSimulada('simulado', 'ocupado')
    ).rejects.toMatchObject({
      status: 409,
      motivo: 'alias_en_uso',
    });
  });

  it('lanza error 401 expirado cuando el token es "simulado-expirado"', async () => {
    await expect(
      crearSesionSimulada('simulado-expirado', 'Ana')
    ).rejects.toMatchObject({
      status: 401,
      motivo: 'expirado',
      mensaje: 'El QR de la mesa expiró, pide uno nuevo al mesero',
    });
  });

  it('lanza error 503 cuando el token es "simulado-caido"', async () => {
    await expect(
      crearSesionSimulada('simulado-caido', 'Ana')
    ).rejects.toMatchObject({
      status: 503,
      mensaje:
        'No se pudo validar el QR: el servicio de tiempo real no responde',
    });
  });
});
