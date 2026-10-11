<!--
Base del PR: develop (main solo se actualiza al cierre de cada sprint).
Título: tipo(scope): descripcion  — minúsculas, infinitivo, sin tildes, <= 72 caracteres.
-->

## Qué hace

<!-- Resumen en 2–4 líneas: qué cambia y por qué. -->

## Actividad

<!-- Código de la actividad o del hallazgo (p. ej. R-03, H4) y enlace al issue si existe. -->

## Cómo probarlo

<!-- Comandos exactos y resultado esperado. -->

```bash
npm test
```

## Cambios de contrato

<!-- Eventos, endpoints, payloads o variables de entorno nuevos o modificados.
     Si no hay, escribe "Ninguno". Todo cambio debe quedar en socket-server/EVENTS.md
     o en backend/docs/api-spec.md y ser compatible hacia atrás. -->

## Checklist de seguridad

- [ ] Entradas validadas en el servidor con lista blanca (tipo, rango, longitud, formato)
- [ ] Ni montos, ni rol, ni `id_mesa` vienen del cliente (salen del JWT o de la base)
- [ ] Autorización por rol en cada evento y endpoint tocado
- [ ] Eventos que cambian estado llevan `eventId` + ack y son idempotentes
- [ ] Firmas comparadas en tiempo constante sobre el cuerpo crudo
- [ ] Ningún secreto en código, pruebas, logs, `.env.example` ni con prefijo `VITE_`
- [ ] Ningún frontend llama a `/internal/*`
- [ ] Toda llamada HTTP saliente tiene timeout
- [ ] Errores genéricos hacia el cliente, sin trazas
- [ ] Pruebas de casos de abuso; `npm test` sin fallidas ni canceladas

## Capturas

<!-- Solo si hay cambios visibles. Sin tokens, QR reales ni datos personales. -->
