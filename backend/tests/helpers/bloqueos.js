/**
 * Cuántas sesiones esperan, directa o indirectamente, un bloqueo que retiene LA
 * CONEXIÓN QUE CONSULTA.
 *
 * Las pruebas de carrera retienen una fila con FOR UPDATE desde una conexión
 * (`reten`), lanzan las peticiones y esperan a verlas en la cola antes de
 * soltar. Antes contaban CUALQUIER sesión de la base con
 * `wait_event_type = 'Lock'`, y con `npm run test:integracion` en paralelo
 * otras suites crean esperas de bloqueo a propósito (pagos-concurrentes,
 * deadlock-pago-estado…): la cuenta podía llegar a 1 antes de que la primera
 * petición estuviera de verdad esperando, se lanzaba la segunda y ganaba la
 * que no tocaba. Pasaba de vez en cuando y siempre en una suite ajena.
 *
 * Por qué una CTE recursiva y no solo `pg_blocking_pids(pid)`: con un bloqueo
 * de FILA, la primera sesión que espera toma el bloqueo de la tupla y espera la
 * transacción de `reten`; la SEGUNDA espera la tupla, así que quien la bloquea
 * es la primera, no `reten`. Se cuenta toda la cadena que cuelga de `reten`.
 */
const SQL_BLOQUEADOS_POR_MI = `
  WITH RECURSIVE cola(pid) AS (
    SELECT a.pid FROM pg_stat_activity a
     WHERE a.datname = current_database() AND pg_backend_pid() = ANY(pg_blocking_pids(a.pid))
    UNION
    SELECT a.pid FROM pg_stat_activity a JOIN cola c ON c.pid = ANY(pg_blocking_pids(a.pid))
     WHERE a.datname = current_database()
  )
  SELECT count(*)::int AS n FROM cola`;

module.exports = { SQL_BLOQUEADOS_POR_MI };
