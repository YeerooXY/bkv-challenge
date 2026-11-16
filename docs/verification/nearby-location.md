# Nearby location and repeated vehicles, 2026-11-16

User screenshot showed AAHY815 repeated at successive stops. Nearby now groups sorted arrivals by normalized plate, then vehicle id or dated trip for unknown plates, keeping the earliest selected boarding opportunity. Different unknown vehicles are retained. The count uses the same grouping.

Nearby GPS requests now use maximumAge 0. More stops expands the selected stop range and retains earlier cards during loading. Requests remain in six-stop batches to respect the existing API limit. Moving to a different candidate-stop set resets expansion and filters. Existing ride logging and map data retain the selected arrival's stop and trip.

Passed 15 Node tests and 33 Python tests. New tests/browser/nearby-location.cjs passed Chromium desktop, WebKit desktop, Pixel 7 Chromium and iPhone 13 WebKit, checking changed GPS coordinates and stops, no duplicate plates, retained earlier results after expansion, six-stop request batching, Tab/Shift+Tab/Enter/Space, focus after More stops disappears, and no horizontal overflow. Inspected screenshots for all four profiles; evidence is in nearby-location/. Light desktop/Android and dark iPhone were captured.

All browser profiles were emulated. Real Android GPS provider freshness, physical-device rendering and a moving bus ride remain untested. maximumAge 0 requests a fresh fix; it cannot guarantee the operating system supplies an accurate location.
