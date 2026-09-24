import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// @react-three/fiber instancie encore THREE.Clock, que three r185 declare
// obsolete a chaque creation. L'avertissement ne concerne pas l'application
// et polluerait la console a chaque vue 3D : on ecarte CE message precis, et
// lui seul — tout autre avertissement passe.
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('THREE.Clock: This module has been deprecated')) {
    return;
  }
  warn(...args);
};

const container = document.getElementById('root');
if (!container) throw new Error('Element #root introuvable.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
