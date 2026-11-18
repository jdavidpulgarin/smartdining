import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import LimiteErrores from './componentes/LimiteErrores.jsx';
import './index.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <LimiteErrores>
        <App />
      </LimiteErrores>
    </React.StrictMode>
  );
}
