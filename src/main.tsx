import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Hidden admin route — not linked anywhere in the UI
const path = window.location.pathname;

let RootComponent: React.ComponentType;

if (path === '/admin/food-generator') {
  const { default: AdminFoodGenerator } = await import('./pages/AdminFoodGenerator.tsx');
  RootComponent = AdminFoodGenerator;
} else {
  RootComponent = App;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
);
