import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// getUserMedia (camera) only works in secure contexts. localhost counts
// as secure over plain HTTP, so local dev needs nothing special — but
// testing from a phone on the LAN requires HTTPS. `npm run dev:host`
// sets HTTPS=1 to enable a self-signed cert via basicSsl.
export default defineConfig({
  // GitHub Pages serves this repo at /nuwa-creation/
  base: '/nuwa-creation/',
  plugins: [react(), ...(process.env.HTTPS ? [basicSsl()] : [])],
});
