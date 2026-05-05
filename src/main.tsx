import React, {StrictMode, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './index.css';

const queryClient = new QueryClient();

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
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>Loading...</div>}>
        <RootComponent />
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
