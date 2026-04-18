import React, {StrictMode, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Hidden admin route — not linked anywhere in the UI
const path = window.location.pathname;

let RootComponent: React.ComponentType;

if (path === '/admin/food-generator') {
  RootComponent = React.lazy(() => import('./pages/AdminFoodGenerator.tsx'));
} else {
  RootComponent = App;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div>Loading...</div>}>
      <RootComponent />
    </Suspense>
  </StrictMode>,
);
