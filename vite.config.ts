import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Basic Vite configuration enabling React support.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  }
});