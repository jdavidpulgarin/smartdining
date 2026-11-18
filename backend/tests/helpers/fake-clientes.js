/**
 * D-19 parte B: doble de base CON ESTADO para las rutas de clientes.
 *
 * Contesta el SQL de clientes.service, sesiones-cliente.service,
 * direcciones.service y zonas.service con tablas en memoria, para que las
 * pruebas unitarias recorran los flujos completos (registro -> login ->
 * refresh -> logout, direcciones, cotizar) sin PostgreSQL. Lo que solo la base
 * real puede probar (FOR UPDATE de verdad, el trigger del script 37,
 * fn_clave_barrio) está en tests/integracion/clientes-sql.test.js.
 *
 * El reloj es `estado.ahora` (ms): las pruebas lo mueven para vencer tokens o
 * salir de la ventana de gracia sin esperar.
 */

const { instalarFakeDb } = require('./fake-db');
const { SQL } = require('../../src/services/sesiones-cliente.service');

/** Igual que fn_clave_barrio de la base, para cotizar en memoria. */
function claveBarrio(texto) {
  const clave = String(texto)
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return clave || null;
}

function crearEstado() {
  return {
    ahora: Date.parse('2026-11-13T12:00:00Z'),
    clientes: [],
    tokens: [],
    direcciones: [],
    zonas: [],
    siguiente: { cliente: 1, token: 1, direccion: 1, zona: 1 },
  };
}

const DIA_MS = 24 * 3600 * 1000;

const publico = (c) => ({
  id_cliente: c.id_cliente,
  nombre: c.nombre,
  email: c.email,
  telefono: c.telefono,
  verificado: c.verificado,
});

const direccionPublica = (d) => ({
  id_direccion: d.id_direccion,
  direccion: d.direccion,
  barrio: d.barrio,
  referencia: d.referencia,
  lat: d.lat,
  lng: d.lng,
  principal: d.principal,
  creado_en: new Date(d.creado_en),
});

/** `col = $N` de un UPDATE dinámico -> { col: params[N-1] }. */
function asignaciones(sql, params) {
  const fuera = {};
  for (const [, col, n] of sql.matchAll(/(\w+) = \$(\d+)::/g)) {
    fuera[col] = params[Number(n) - 1];
  }
  return fuera;
}

/**
 * Instala el doble. `opciones.extra(sql, params)` contesta antes que el modelo
 * (para forzar errores). Devuelve `{ estado, db, restaurar }`.
 */
function instalarFakeClientes({ estado = crearEstado(), extra } = {}) {
  const tokenPorId = (id) => estado.tokens.find((t) => String(t.id) === String(id));

  const responder = (sql, params) => {
    if (extra) {
      const r = extra(sql, params);
      if (r) return r;
    }

    // --- refresh_tokens_cliente (SQL exacto del servicio) -------------------
    if (sql === SQL.insertar) {
      const [idCliente, hash, familia, dias] = params;
      const fila = {
        id: String(estado.siguiente.token++),
        id_cliente: idCliente,
        hash,
        familia,
        creado_en: estado.ahora,
        expira_en: estado.ahora + dias * DIA_MS,
        rotado_en: null,
        reemplazado_por: null,
        revocado_en: null,
      };
      estado.tokens.push(fila);
      return { rows: [{ id: fila.id }] };
    }
    if (sql === SQL.buscarPorHash) {
      const [hash, gracia] = params;
      const t = estado.tokens.find((x) => x.hash === hash);
      if (!t) return { rows: [] };
      const c = estado.clientes.find((x) => x.id_cliente === t.id_cliente);
      return {
        rows: [
          {
            id: t.id,
            id_cliente: t.id_cliente,
            familia: t.familia,
            reemplazado_por: t.reemplazado_por,
            revocado: t.revocado_en !== null,
            vencido: t.expira_en <= estado.ahora,
            en_gracia: t.rotado_en !== null && estado.ahora - t.rotado_en <= gracia * 1000,
            cliente_activo: Boolean(c && c.activo),
          },
        ],
      };
    }
    if (sql === SQL.bloquearReemplazo) {
      const t = tokenPorId(params[0]);
      return {
        rows: t ? [{ id: t.id, reemplazado_por: t.reemplazado_por, revocado: t.revocado_en !== null }] : [],
      };
    }
    if (sql === SQL.revocarFamilia) {
      for (const t of estado.tokens) {
        if (t.familia === params[0] && t.revocado_en === null) t.revocado_en = estado.ahora;
      }
      return { rows: [] };
    }
    if (sql === SQL.revocarUno) {
      const t = tokenPorId(params[0]);
      if (t && t.revocado_en === null) t.revocado_en = estado.ahora;
      return { rows: [] };
    }
    if (sql === SQL.rotar) {
      const t = tokenPorId(params[0]);
      // Lo mismo que el trigger tr_refresh_rotacion: rotado_en no se mueve.
      if (t.rotado_en !== null) throw Object.assign(new Error('rotado_en no cambia'), { code: '23514' });
      t.reemplazado_por = String(params[1]);
      t.rotado_en = estado.ahora;
      return { rows: [] };
    }
    if (sql === SQL.reapuntar) {
      tokenPorId(params[0]).reemplazado_por = String(params[1]);
      return { rows: [] };
    }
    if (sql === SQL.logout) {
      const t = estado.tokens.find((x) => x.hash === params[0]);
      if (t && t.revocado_en === null) t.revocado_en = estado.ahora;
      return { rows: [] };
    }

    // --- clientes ------------------------------------------------------------
    if (sql.includes('FROM clientes WHERE lower(email) = $1::text')) {
      const c = estado.clientes.find((x) => x.email.toLowerCase() === params[0]);
      return { rows: c ? [{ ...publico(c), activo: c.activo, password_hash: c.password_hash }] : [] };
    }
    if (sql.includes('INSERT INTO clientes')) {
      const [nombre, email, telefono, password_hash] = params;
      if (estado.clientes.some((x) => x.email.toLowerCase() === email.toLowerCase())) {
        throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_clientes_email' });
      }
      const c = {
        id_cliente: estado.siguiente.cliente++,
        nombre,
        email,
        telefono,
        password_hash,
        verificado: false,
        activo: true,
      };
      estado.clientes.push(c);
      return { rows: [publico(c)] };
    }
    if (sql.includes('SELECT id_cliente, activo FROM clientes')) {
      const c = estado.clientes.find((x) => x.id_cliente === params[0]);
      return { rows: c ? [{ id_cliente: c.id_cliente, activo: c.activo }] : [] };
    }
    if (sql.includes('SELECT id_cliente FROM clientes WHERE id_cliente = $1::int FOR UPDATE')) {
      const c = estado.clientes.find((x) => x.id_cliente === params[0]);
      return { rows: c ? [{ id_cliente: c.id_cliente }] : [] };
    }
    if (sql.includes('FROM clientes WHERE id_cliente = $1::int')) {
      const c = estado.clientes.find((x) => x.id_cliente === params[0]);
      return { rows: c ? [publico(c)] : [] };
    }
    if (sql.includes('UPDATE clientes SET')) {
      const c = estado.clientes.find((x) => x.id_cliente === params[0]);
      if (!c) return { rows: [] };
      Object.assign(c, asignaciones(sql, params));
      return { rows: [publico(c)] };
    }

    // --- direcciones ---------------------------------------------------------
    const deCliente = (id) => estado.direcciones.filter((d) => d.id_cliente === id);
    if (sql.includes('count(*)::int AS n FROM direcciones')) {
      return { rows: [{ n: deCliente(params[0]).length }] };
    }
    if (sql.includes('UPDATE direcciones SET principal = FALSE')) {
      for (const d of deCliente(params[0])) d.principal = false;
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO direcciones')) {
      const [id_cliente, direccion, barrio, referencia, lat, lng, principal] = params;
      if (principal && deCliente(id_cliente).some((d) => d.principal)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_direcciones_principal' });
      }
      const d = {
        id_direccion: estado.siguiente.direccion++,
        id_cliente,
        direccion,
        barrio,
        referencia,
        lat,
        lng,
        principal,
        creado_en: estado.ahora++,
      };
      estado.direcciones.push(d);
      return { rows: [direccionPublica(d)] };
    }
    if (sql.includes('FROM direcciones') && sql.includes('ORDER BY principal DESC')) {
      const filas = deCliente(params[0]).sort(
        (a, b) => Number(b.principal) - Number(a.principal) || b.creado_en - a.creado_en || b.id_direccion - a.id_direccion
      );
      return { rows: filas.map(direccionPublica) };
    }
    if (sql.includes('FROM direcciones') && sql.includes('WHERE id_direccion = $1::int AND id_cliente = $2::int') && sql.includes('FOR UPDATE')) {
      const d = estado.direcciones.find((x) => x.id_direccion === params[0] && x.id_cliente === params[1]);
      return { rows: d ? [direccionPublica(d)] : [] };
    }
    if (sql.includes('UPDATE direcciones SET') && sql.includes('WHERE id_direccion = $1::int AND id_cliente = $2::int')) {
      const d = estado.direcciones.find((x) => x.id_direccion === params[0] && x.id_cliente === params[1]);
      if (!d) return { rows: [] };
      const cambios = asignaciones(sql, params);
      if (cambios.principal && deCliente(d.id_cliente).some((x) => x !== d && x.principal)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_direcciones_principal' });
      }
      Object.assign(d, cambios);
      return { rows: [direccionPublica(d)] };
    }
    if (sql.includes('DELETE FROM direcciones')) {
      const i = estado.direcciones.findIndex((x) => x.id_direccion === params[0] && x.id_cliente === params[1]);
      if (i < 0) return { rows: [] };
      const [borrada] = estado.direcciones.splice(i, 1);
      return { rows: [{ principal: borrada.principal }] };
    }
    if (sql.includes('UPDATE direcciones SET principal = TRUE')) {
      const restantes = deCliente(params[0]).sort((a, b) => b.creado_en - a.creado_en || b.id_direccion - a.id_direccion);
      if (restantes[0]) restantes[0].principal = true;
      return { rows: [] };
    }

    // --- zonas ---------------------------------------------------------------
    if (sql.includes('FROM zonas_envio') && sql.includes('WHERE activa')) {
      return {
        rows: estado.zonas
          .filter((z) => z.activa)
          .sort((a, b) => a.id_zona - b.id_zona)
          .map(({ id_zona, nombre, barrios, costo_envio, tiempo_estimado_min }) => ({
            id_zona,
            nombre,
            barrios,
            costo_envio,
            tiempo_estimado_min,
          })),
      };
    }
    if (sql.includes('cotizar_zona(d.barrio::text)')) {
      const d = estado.direcciones.find((x) => x.id_direccion === params[0] && x.id_cliente === params[1]);
      if (!d) return { rows: [] };
      const z = estado.zonas
        .filter((x) => x.activa && x.barrios.some((b) => claveBarrio(b) === claveBarrio(d.barrio)))
        .sort((a, b) => a.id_zona - b.id_zona)[0];
      return {
        rows: [
          z
            ? { id_direccion: d.id_direccion, id_zona: z.id_zona, nombre: z.nombre, costo_envio: z.costo_envio, tiempo_estimado_min: z.tiempo_estimado_min }
            : { id_direccion: d.id_direccion, id_zona: null, nombre: null, costo_envio: null, tiempo_estimado_min: null },
        ],
      };
    }

    return undefined;
  };

  const db = instalarFakeDb(responder);
  return { estado, db, restaurar: () => db.restaurar() };
}

/** Agrega una zona al estado. */
function agregarZona(estado, { nombre, barrios, costo_envio = 5000, tiempo_estimado_min = 40, activa = true }) {
  const z = { id_zona: estado.siguiente.zona++, nombre, barrios, costo_envio, tiempo_estimado_min, activa };
  estado.zonas.push(z);
  return z;
}

module.exports = { instalarFakeClientes, crearEstado, agregarZona, claveBarrio, DIA_MS };
