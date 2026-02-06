import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import Dashboard from './components/Dashboard';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>
);