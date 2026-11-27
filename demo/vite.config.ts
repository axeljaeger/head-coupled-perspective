import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';

const lib = (p: string) => fileURLToPath(new URL(`../packages/head-coupled-perspective/src/${p}`, import.meta.url));

// `npm run dev:lan` serves over HTTPS on the local network, which browsers on
// other devices (e.g. an iPad) require before they allow camera access.
// The library is consumed from source, so edits to it hot-reload in the demo.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'lan' ? [basicSsl()] : [],
  server: mode === 'lan' ? { host: true } : {},
  resolve: {
    alias: [
      { find: /^head-coupled-perspective\/three$/, replacement: lib('three.ts') },
      { find: /^head-coupled-perspective$/, replacement: lib('index.ts') },
    ],
  },
}));
