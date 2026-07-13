import { defineConfig } from 'vite';

// Server config tuned for remote/device testing (BrowserStack Local, real phones on
// the LAN, tunnels like ngrok). Two things matter for those:
//   • host: true      → listen on 0.0.0.0 so the server is reachable off-machine,
//                        not just on 127.0.0.1/localhost.
//   • allowedHosts    → Vite blocks requests whose Host header it doesn't recognise
//                        (anti DNS-rebinding). BrowserStack Local serves the app as
//                        `bs-local.com:<port>`, and tunnels use their own hostnames,
//                        so those must be allowed or Vite returns "Blocked request".
//
// `true` disables the host check entirely — fine for a local test server, not for
// production hosting.
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
  },
});
