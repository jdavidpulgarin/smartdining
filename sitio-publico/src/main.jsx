import React from 'react';
import ReactDOM from 'react-dom/client';
import Carta from './Carta.jsx';
import './index.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Carta />
    </React.StrictMode>
  );
}
