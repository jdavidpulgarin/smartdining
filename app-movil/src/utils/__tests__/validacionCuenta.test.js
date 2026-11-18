import { validarFormularioCuenta } from '../validacionCuenta';

describe('validacionFormularioCuenta', () => {
  test('valida correo y longitud de contrasena en login', () => {
    const invalido = validarFormularioCuenta({
      modo: 'login',
      correo: 'correo-malo',
      password: '123',
    });
    expect(invalido.valido).toBe(false);
    expect(invalido.errores.correo).toBeTruthy();
    expect(invalido.errores.password).toBeTruthy();

    const valido = validarFormularioCuenta({
      modo: 'login',
      correo: 'juan@smartdining.com.co',
      password: 'password123',
    });
    expect(valido.valido).toBe(true);
    expect(valido.errores).toEqual({});
  });

  test('exige nombre en modo registro', () => {
    const sinNombre = validarFormularioCuenta({
      modo: 'registro',
      nombre: ' ',
      correo: 'juan@smartdining.com.co',
      password: 'password123',
    });
    expect(sinNombre.valido).toBe(false);
    expect(sinNombre.errores.nombre).toBeTruthy();
  });
});
