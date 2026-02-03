import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Service Worker
// - Only register in production builds.
// - During local dev (Vite), proactively unregister any existing SW so it
//   doesn't hijack requests like /@vite/client and break hot reload.
if ('serviceWorker' in navigator) {
  const isDev = import.meta.env?.DEV;
  const isProd = import.meta.env?.PROD;

  if (isDev) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
  }

  if (isProd) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
