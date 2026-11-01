import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = `http://localhost:${process.env.PORT || 3001}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target, ws: true },
      '/api': { target },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
