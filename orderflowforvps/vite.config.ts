import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Basic Vite configuration enabling React support.  This config
// requires no customization for this simple dashboard.
export default defineConfig({
  plugins: [react()],
});