import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  if (command === 'build' && process.env.VERCEL === '1' && !/^https:\/\/[^/]+\/api\/?$/.test(process.env.VITE_API_URL || '')) {
    throw new Error('Vercel production builds require VITE_API_URL as an HTTPS backend URL ending in /api.');
  }
  return {
    plugins: [react()],
    server: { host: true, port: 5173 },
    test: { environment: 'jsdom', setupFiles: './src/test-setup.js' }
  };
});
