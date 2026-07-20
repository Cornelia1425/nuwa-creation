import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// getUserMedia (camera) only works in secure contexts. localhost counts
// as secure over plain HTTP, so local dev needs nothing special — but
// testing from a phone on the LAN requires HTTPS. `npm run dev:host`
// sets HTTPS=1 to enable a self-signed cert via basicSsl.
export default defineConfig(({ command }) => ({
  // Local `vite` / `vite preview` use `/`. Production builds for
  // GitHub Pages need the repo subpath so assets resolve correctly.
  base: command === 'build' ? '/nuwa-creation/' : '/',
  plugins: [react(), ...(process.env.HTTPS ? [basicSsl()] : [])],
}));
