# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Sin datos simulados (P-13)

El panel **no finge guardar**: si el backend no responde o rechaza un cambio (agotar un
plato, guardar o borrar un plato o una categoría, el constructor, abrir o rotar el QR de
una mesa), la pantalla vuelve a como estaba y muestra **"Sin conexión, no se guardó"** o
el error real del servidor. No hay copias en `localStorage` ni QR generados en el
navegador.

`VITE_USE_MOCKS=true` solo vale en desarrollo explícito (`npm run dev`): hoy solo afecta a
Reportes, que muestra datos de demostración con un aviso. En un build de producción
(`npm run build`) se ignora siempre.
