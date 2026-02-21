import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import Dashboard from './components/Dashboard';
import ConfigurationError from './components/ConfigurationError';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isProxyApiKeyConfigured, isViewerModeEnabled } from './services/proxyAuth';

const canBootDashboard = isProxyApiKeyConfigured() || isViewerModeEnabled();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {canBootDashboard ? (
        <Dashboard />
      ) : (
        <ConfigurationError message="VITE_PROXY_API_KEY veya viewerToken eksik. Read-only izleme icin URL'e ?viewer=1&viewerToken=... ekleyin." />
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
