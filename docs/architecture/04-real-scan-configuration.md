# Real scan configuration

The GitHub Pages build is static and cannot execute the Node/Playwright scanner. It no longer returns demo accessibility findings.

To use GitHub Pages as the development frontend for real scans:

1. Deploy the backend and scanner supervisor on the controlled Linux scanner environment.
2. Expose the backend through HTTPS.
3. Build the frontend with `VITE_API_BASE_URL=https://<backend-host>`.
4. Start the backend with `FRONTEND_ORIGINS=https://tenzindarkhang715.github.io` and `SCANNER_SOCKET_PATH` pointing at the supervisor socket.

`Page Test` scans only the submitted page. `Site Test` performs a bounded same-host crawl (maximum 25 pages, depth 3) and runs axe on each eligible page. Every discovered page is independently assessed by the existing target policy before navigation. External hosts are not added to the crawl queue.

The production network/proxy boundary remains the connection-enforcement layer; crawl scope does not replace SSRF, DNS, proxy, namespace, sandbox, or egress controls.

## Local Mac-to-Linux validation

Linux checkout: `/opt/accessibility-scanner-validation`.
Service: `accessibility-scanner-validation.service`.
Supervisor socket: `/run/accessibility-scanner/validation-supervisor.sock`.

Run the Linux loopback relay in its own terminal:
```bash
sudo socat -d -d TCP4-LISTEN:39123,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/run/accessibility-scanner/validation-supervisor.sock
```

Run the SSH tunnel in a separate Mac terminal:
```bash
ssh -N -o ExitOnForwardFailure=yes -L /tmp/accessibility-scanner-validation.sock:127.0.0.1:39123 tenzin@192.168.64.2
```

Start the Mac backend after building it:
```bash
cd ~/Desktop/AccessibilityLatest2026/backend
npm run build
SCANNER_SOCKET_PATH=/tmp/accessibility-scanner-validation.sock FRONTEND_ORIGINS=http://127.0.0.1:4173 HOST=127.0.0.1 PORT=3001 node dist/index.js
```

Build and preview the frontend in another Mac terminal:
```bash
cd ~/Desktop/AccessibilityLatest2026
VITE_API_BASE_URL=http://127.0.0.1:3001 npm run build:github
npm run preview:github -- --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/AccessibilityLatest2026/`.

Keep the relay, tunnel, backend, and preview running during validation.
This manual setup is separate from final production deployment.
The frontend API URL is embedded at build time. GitHub Pages requires a reachable HTTPS backend, not this local loopback URL.
The legacy `/opt/scanner` deployment remains separate.
