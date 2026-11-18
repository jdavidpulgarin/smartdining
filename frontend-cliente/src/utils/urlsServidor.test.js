import { describe, it, expect } from 'vitest';
import { resolverUrls, urlsServidor } from './urlsServidor';

describe('resolverUrls (modo red local)', () => {
  it('usa variables de entorno si vienen definidas', () => {
    const res = resolverUrls({
      apiEnv: 'http://servidor-remoto:4000/api',
      socketEnv: 'http://servidor-remoto:4001',
      esDev: true,
      ubicacion: { protocol: 'http:', hostname: '192.168.1.7' },
    });

    expect(res.api).toBe('http://servidor-remoto:4000/api');
    expect(res.socket).toBe('http://servidor-remoto:4001');
  });

  it('remueve barras finales de las variables de entorno', () => {
    const res = resolverUrls({
      apiEnv: 'http://servidor-remoto:4000/api///',
      socketEnv: 'http://servidor-remoto:4001/',
      esDev: false,
      ubicacion: { protocol: 'http:', hostname: 'localhost' },
    });

    expect(res.api).toBe('http://servidor-remoto:4000/api');
    expect(res.socket).toBe('http://servidor-remoto:4001');
  });

  it('resuelve URLs en dev con hostname de red local (ej. 192.168.1.7) cuando no hay variables', () => {
    const res = resolverUrls({
      apiEnv: undefined,
      socketEnv: undefined,
      esDev: true,
      ubicacion: { protocol: 'http:', hostname: '192.168.1.7' },
    });

    expect(res.api).toBe('http://192.168.1.7:4000/api');
    expect(res.socket).toBe('http://192.168.1.7:4001');
  });

  it('resuelve URLs en dev con localhost cuando no hay variables', () => {
    const res = resolverUrls({
      apiEnv: undefined,
      socketEnv: undefined,
      esDev: true,
      ubicacion: { protocol: 'http:', hostname: 'localhost' },
    });

    expect(res.api).toBe('http://localhost:4000/api');
    expect(res.socket).toBe('http://localhost:4001');
  });

  it('en producción sin variables usa api localhost y socket undefined', () => {
    const res = resolverUrls({
      apiEnv: undefined,
      socketEnv: undefined,
      esDev: false,
      ubicacion: { protocol: 'http:', hostname: '192.168.1.7' },
    });

    expect(res.api).toBe('http://localhost:4000/api');
    expect(res.socket).toBeUndefined();
  });

  it('urlsServidor expone las URLs resueltas del entorno actual', () => {
    const res = urlsServidor();
    expect(typeof res.api).toBe('string');
    expect(res.api.length).toBeGreaterThan(0);
    expect(res.socket === undefined || typeof res.socket === 'string').toBe(true);
  });
});
