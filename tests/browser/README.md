# Browser checks

Start `python -B backend/server.py` on port 8000. Run these with an available Playwright installation and its Chromium/WebKit browsers:

```powershell
$env:PLAYWRIGHT_MODULE = 'C:\path\to\node_modules\playwright'
node tests/browser/nearby.cjs
node tests/browser/recovery.cjs
node tests/browser/reconciliation.cjs
node tests/browser/nearby-ui.cjs
```

If Playwright resolves normally from this project, omit `PLAYWRIGHT_MODULE`. These checks use isolated browser profiles and synthetic API responses, never a BKK key. They do not read the user's normal browser ride database. Map tiles use the configured provider. Evidence goes to `docs/verification/nearby-lead/`.

`nearby.cjs` checks Chromium desktop, WebKit desktop, Pixel 7 Chromium and iPhone 13 WebKit. It drives rows, keyboard focus, the map, Board, Get off, photo saving, a simulated ten-minute clock and short manual rides. Recovery checks cover reload, offline completion, failed saves and concurrent tabs. Reconciliation checks cover edits during pending API requests and the offline service-worker boundary.

These are emulations. A physical bus ride, background GPS behavior and actual macOS/iOS rendering remain separate checks.

`nearby-ui.cjs` checks the default Nearby mode, automatic 30-second refresh, on-demand refresh, paused requests outside Nearby, missing-backend recovery, and stacked cards/stop filters in light and dark across those four profiles plus a 320px viewport. Its screenshots and results go to `docs/verification/nearby-cards/`.
