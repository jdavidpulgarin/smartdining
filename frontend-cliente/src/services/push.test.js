import { describe, expect, it, vi } from 'vitest';
import {
  soportePush,
  puedePedirPermiso,
  urlBase64AUint8Array,
  suscribir,
  desuscribir,
} from './push';

describe('push service (J-09)', () => {
  describe('soportePush', () => {
    it('devuelve "ok" en un navegador con ServiceWorker, PushManager y Notification', () => {
      expect(
        soportePush({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
          platform: 'Win32',
          maxTouchPoints: 0,
          navigatorStandalone: false,
          displayModeStandalone: false,
          tieneServiceWorker: true,
          tienePushManager: true,
          tieneNotification: true,
        })
      ).toBe('ok');
    });

    it('devuelve "ios_sin_instalar" en iPhone cuando NO esta en modo standalone', () => {
      expect(
        soportePush({
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
          platform: 'iPhone',
          maxTouchPoints: 5,
          navigatorStandalone: false,
          displayModeStandalone: false,
          tieneServiceWorker: true,
          tienePushManager: false,
          tieneNotification: false,
        })
      ).toBe('ios_sin_instalar');
    });

    it('devuelve "ios_sin_instalar" en iPad (incluyendo iPadOS con MacIntel y maxTouchPoints > 1) fuera de standalone', () => {
      expect(
        soportePush({
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
          platform: 'MacIntel',
          maxTouchPoints: 5,
          navigatorStandalone: false,
          displayModeStandalone: false,
          tieneServiceWorker: true,
          tienePushManager: false,
          tieneNotification: false,
        })
      ).toBe('ios_sin_instalar');
    });

    it('devuelve "ok" en iPhone cuando la PWA esta instalada (navigator.standalone o display-mode: standalone)', () => {
      expect(
        soportePush({
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
          platform: 'iPhone',
          maxTouchPoints: 5,
          navigatorStandalone: true,
          displayModeStandalone: false,
          tieneServiceWorker: true,
          tienePushManager: true,
          tieneNotification: true,
        })
      ).toBe('ok');

      expect(
        soportePush({
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
          platform: 'iPhone',
          maxTouchPoints: 5,
          navigatorStandalone: false,
          displayModeStandalone: true,
          tieneServiceWorker: true,
          tienePushManager: true,
          tieneNotification: true,
        })
      ).toBe('ok');
    });

    it('devuelve "sin_soporte" cuando falta PushManager, ServiceWorker o Notification en un dispositivo no iOS', () => {
      expect(
        soportePush({
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
          platform: 'Linux x86_64',
          maxTouchPoints: 0,
          navigatorStandalone: false,
          displayModeStandalone: false,
          tieneServiceWorker: true,
          tienePushManager: false,
          tieneNotification: true,
        })
      ).toBe('sin_soporte');
    });
  });

  describe('puedePedirPermiso', () => {
    it('devuelve true solo con soporte "ok", permiso "default", sin haber preguntado y con pedido confirmado', () => {
      expect(
        puedePedirPermiso({
          soporte: 'ok',
          permiso: 'default',
          yaPregunto: false,
          tienePedidoConfirmado: true,
        })
      ).toBe(true);
    });

    it('devuelve false si ya pregunto, no hay pedido confirmado, permiso no es default o soporte no es ok', () => {
      expect(
        puedePedirPermiso({
          soporte: 'ok',
          permiso: 'default',
          yaPregunto: true,
          tienePedidoConfirmado: true,
        })
      ).toBe(false);

      expect(
        puedePedirPermiso({
          soporte: 'ok',
          permiso: 'default',
          yaPregunto: false,
          tienePedidoConfirmado: false,
        })
      ).toBe(false);

      expect(
        puedePedirPermiso({
          soporte: 'ok',
          permiso: 'granted',
          yaPregunto: false,
          tienePedidoConfirmado: true,
        })
      ).toBe(false);

      expect(
        puedePedirPermiso({
          soporte: 'ok',
          permiso: 'denied',
          yaPregunto: false,
          tienePedidoConfirmado: true,
        })
      ).toBe(false);

      expect(
        puedePedirPermiso({
          soporte: 'ios_sin_instalar',
          permiso: 'default',
          yaPregunto: false,
          tienePedidoConfirmado: true,
        })
      ).toBe(false);
    });
  });

  describe('urlBase64AUint8Array', () => {
    it('convierte una clave base64url sin relleno a Uint8Array', () => {
      // Base64url para los bytes [4, 251, 255, 1] -> "BPv_AQ"
      const bytes = urlBase64AUint8Array('BPv_AQ');
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(bytes)).toEqual([4, 251, 255, 1]);
    });

    it('lanza error si la clave esta vacia o no es string', () => {
      expect(() => urlBase64AUint8Array('')).toThrow();
      expect(() => urlBase64AUint8Array(null)).toThrow();
    });
  });

  describe('suscribir y desuscribir', () => {
    const entornoOk = {
      userAgent: 'Mozilla/5.0 Chrome/124.0',
      platform: 'Win32',
      maxTouchPoints: 0,
      navigatorStandalone: false,
      displayModeStandalone: false,
      tieneServiceWorker: true,
      tienePushManager: true,
      tieneNotification: true,
    };

    const subMock = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc-123',
      keys: { p256dh: 'BN1234', auth: 'k85678' },
    };

    it('pide GET /push/clave-publica, suscribe con PushManager y envia POST /push/suscripcion con Bearer', async () => {
      const subscribeSpy = vi.fn().mockResolvedValue(subMock);
      const swContainer = {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe: subscribeSpy,
          },
        }),
      };

      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ clave: 'BPv_AQ' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ ok: true }),
        });

      const res = await suscribir({
        token: 'jwt-comensal-ana',
        socketUrl: 'http://localhost:4001',
        fetchFn,
        swContainer,
        permisoActual: 'granted',
        entornoSoporte: entornoOk,
      });

      expect(res.ok).toBe(true);
      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      expect(subscribeSpy).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });

      expect(fetchFn).toHaveBeenNthCalledWith(
        1,
        'http://localhost:4001/push/clave-publica',
        { method: 'GET' }
      );
      expect(fetchFn).toHaveBeenNthCalledWith(
        2,
        'http://localhost:4001/push/suscripcion',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer jwt-comensal-ana',
          },
          body: JSON.stringify({ subscription: subMock }),
        }
      );
    });

    it('reutiliza la suscripcion existente sin volver a llamar a pushManager.subscribe', async () => {
      const subscribeSpy = vi.fn();
      const swContainer = {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(subMock),
            subscribe: subscribeSpy,
          },
        }),
      };

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ ok: true }),
      });

      const res = await suscribir({
        token: 'jwt-comensal-ana',
        socketUrl: 'http://localhost:4001',
        fetchFn,
        swContainer,
        permisoActual: 'granted',
        entornoSoporte: entornoOk,
      });

      expect(res.ok).toBe(true);
      expect(subscribeSpy).not.toHaveBeenCalled();
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledWith(
        'http://localhost:4001/push/suscripcion',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('no rompe la app si GET /push/clave-publica responde 503 o el permiso esta denegado', async () => {
      const swContainer = {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe: vi.fn(),
          },
        }),
      };

      const fetch503 = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const res503 = await suscribir({
        token: 'jwt-comensal-ana',
        socketUrl: 'http://localhost:4001',
        fetchFn: fetch503,
        swContainer,
        permisoActual: 'granted',
        entornoSoporte: entornoOk,
      });
      expect(res503).toEqual({ ok: false, motivo: 'sin_vapid' });

      const resDenegado = await suscribir({
        token: 'jwt-comensal-ana',
        socketUrl: 'http://localhost:4001',
        fetchFn: fetch503,
        swContainer,
        permisoActual: 'denied',
        entornoSoporte: entornoOk,
      });
      expect(resDenegado).toEqual({ ok: false, motivo: 'permiso_denegado' });
    });

    it('desuscribir envia DELETE /push/suscripcion con el endpoint y el Bearer', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const res = await desuscribir({
        endpoint: subMock.endpoint,
        token: 'jwt-comensal-ana',
        socketUrl: 'http://localhost:4001',
        fetchFn,
      });

      expect(res.ok).toBe(true);
      expect(fetchFn).toHaveBeenCalledWith(
        'http://localhost:4001/push/suscripcion',
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer jwt-comensal-ana',
          },
          body: JSON.stringify({ endpoint: subMock.endpoint }),
        }
      );
    });
  });
});
