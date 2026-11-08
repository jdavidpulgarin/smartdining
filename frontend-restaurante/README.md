# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Pruebas del panel

```bash
npm test            # Vitest: unitarias y de componentes (las corre el CI)
npm run test:e2e    # Playwright: E2E con el sistema entero levantado (a mano, no en el CI)
```

Las E2E (`e2e/panel.spec.js`) necesitan la base de pruebas, el backend, el socket-server
y el cliente corriendo; el paso a paso está en
[`database/tests/README.md`](../database/tests/README.md). Usan el Chromium de Playwright
(`npx playwright install chromium` la primera vez); para otro navegador, define
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
