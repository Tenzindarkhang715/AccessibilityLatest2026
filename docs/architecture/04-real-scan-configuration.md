# Real scan configuration

The GitHub Pages build is static and cannot execute the Node/Playwright scanner. It no longer returns demo accessibility findings.

To use GitHub Pages as the development frontend for real scans:

1. Deploy the backend and scanner supervisor on the controlled Linux scanner environment.
2. Expose the backend through HTTPS.
3. Build the frontend with `VITE_API_BASE_URL=https://<backend-host>`.
4. Start the backend with `FRONTEND_ORIGINS=https://tenzindarkhang715.github.io` and `SCANNER_SOCKET_PATH` pointing at the supervisor socket.

`Page Test` scans only the submitted page. `Site Test` performs a bounded same-host crawl (maximum 25 pages, depth 3) and runs axe on each eligible page. Every discovered page is independently assessed by the existing target policy before navigation. External hosts are not added to the crawl queue.

The production network/proxy boundary remains the connection-enforcement layer; crawl scope does not replace SSRF, DNS, proxy, namespace, sandbox, or egress controls.
