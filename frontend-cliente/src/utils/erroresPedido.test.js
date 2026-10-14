import { describe, expect, it } from 'vitest';
import { traducirErrorPedido } from './erroresPedido';
import { ErrorApi } from '../services/api';

describe('traducirErrorPedido (J-05)', () => {
  it('maneja error 409 (plato o ingrediente agotado) indicando recargarMenu', () => {
    const error409 = new ErrorApi({
      status: 409,
      motivo: 'agotado',
      mensaje: 'El plato o ingrediente seleccionado se agotó.',
    });

    const res = traducirErrorPedido(error409);

    expect(res).toEqual({
      tipo: 409,
      mensaje: 'El plato o ingrediente seleccionado se agotó.',
      ayuda: 'Revisa tu pedido: algo se agotó en cocina',
      recargarMenu: true,
    });
  });

  it('maneja error 429 (rate limit) extrayendo retryAfter y configurando bloquearSegundos', () => {
    const error429 = new ErrorApi({
      status: 429,
      retryAfter: 30,
    });

    const res = traducirErrorPedido(error429);

    expect(res).toEqual({
      tipo: 429,
      mensaje: 'Demasiados intentos. Espera 30 segundos',
      bloquearSegundos: 30,
    });
  });

  it('maneja error 429 sin retryAfter usando 60 segundos por defecto', () => {
    const error429 = new ErrorApi({
      status: 429,
    });

    const res = traducirErrorPedido(error429);
    expect(res.bloquearSegundos).toBe(60);
    expect(res.mensaje).toBe('Demasiados intentos. Espera 60 segundos');
  });

  it('maneja error de conexion (status 0 o sin_conexion) marcando esConexion para permitir reintentar', () => {
    const errorConexion = new ErrorApi({
      status: 0,
      motivo: 'sin_conexion',
      mensaje: 'Sin conexión',
    });

    const res = traducirErrorPedido(errorConexion);

    expect(res).toEqual({
      tipo: 0,
      mensaje:
        'No pudimos enviar tu pedido. Revisa tu conexión a internet e intenta de nuevo',
      esConexion: true,
    });
  });

  it('maneja errores de validación de backend 400 y 422', () => {
    const error400 = new ErrorApi({
      status: 400,
      mensaje: 'Estructura de ítems inválida',
    });

    const res400 = traducirErrorPedido(error400);
    expect(res400).toEqual({
      tipo: 400,
      mensaje: 'Estructura de ítems inválida',
    });

    const error422 = new ErrorApi({
      status: 422,
      mensaje: 'Cantidad fuera de rango permitido',
    });

    const res422 = traducirErrorPedido(error422);
    expect(res422).toEqual({
      tipo: 422,
      mensaje: 'Cantidad fuera de rango permitido',
    });
  });

  it('maneja error 401 marcando ignorar: true para no competir con el manejador de sesión central', () => {
    const error401 = new ErrorApi({
      status: 401,
      motivo: 'expirado',
      mensaje: 'Token inválido',
    });

    const res = traducirErrorPedido(error401);
    expect(res.tipo).toBe(401);
    expect(res.ignorar).toBe(true);
  });

  it('maneja errores locales o desconocidos como tipo "local"', () => {
    const errLocal = new Error('Un pedido no puede contener más de 50 ítems');
    const res = traducirErrorPedido(errLocal);

    expect(res).toEqual({
      tipo: 'local',
      mensaje: 'Un pedido no puede contener más de 50 ítems',
    });
  });
});
