import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In Docker the built site is served by nginx, which proxies /api and /ws to
// the gateway. `npm run dev` proxies the same two prefixes here so the app code
// never needs to know which of the two it is running under.
const gateway = process.env.VITE_GATEWAY_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: gateway, changeOrigin: true },
      '/ws': { target: gateway, changeOrigin: true, ws: true },
    },
  },
});
