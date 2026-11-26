import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:lan` serves over HTTPS on the local network, which browsers on
// other devices (e.g. an iPad) require before they allow camera access.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'lan' ? [basicSsl()] : [],
  server: mode === 'lan' ? { host: true } : {},
}));
