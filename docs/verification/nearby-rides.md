# Nearby rides verification

Verified 11 November 2026 on the local working tree based on c61f763. The existing Plates photo layout is preserved. No deployment, authenticated BKK request or physical ride was performed.

## Results

- `node --test tests/ride-core.test.js`: 14 passed.
- `python -I -B -m unittest discover -s tests -p "test_*.py" -v`: 31 passed.
- `node --check` for app.js, nearby.js, ride-core.js, minimap.js and sw.js: passed.
- `git diff --check`: passed, with existing Windows line-ending notices.
- Browser commands in `tests/browser/README.md`: all passed using the cached Playwright installation. Results and screenshots are under `nearby-lead/`.
- Service worker cache is v19. Offline application loading passed; failed API requests never become cached HTML.
- Regenerated `data/stops.json` from the public BKK static GTFS: 5,596 official platform IDs and 361 line patterns. Service/timetable outputs from this check were kept outside the project to preserve unrelated data.

## Browser coverage

| Profile | Environment | Evidence |
| --- | --- | --- |
| PC | Headless Chromium on Windows, 1440 x 1000 | pc-arrivals.png, pc-map.png, pc-saved.png |
| Mac | Desktop WebKit profile, 1440 x 1000, emulated | mac-arrivals.png, mac-map.png, mac-saved.png |
| Android | Chromium Pixel 7 profile, emulated | android-arrivals.png, android-map.png, android-saved.png |
| iPhone | WebKit iPhone 13 profile, emulated | iphone-arrivals.png, iphone-map.png, iphone-saved.png |

All screenshots are in `nearby-lead/`. Arrival data is a synthetic response supplied only by the test harness. Maps load real configured OpenStreetMap tiles. These screenshots do not establish actual BKK feed population, macOS/iOS fonts, physical GPS or locked-screen behavior.

Each profile passed arrival sorting, unknown-plate handling, the red original/predicted pair, no page-width overflow, map opening, Tab/Shift+Tab/Enter/Space/Escape, focus after refresh and dialog close, Board autofill, no premature terminal selection, ten-minute completion with a required photo, reload without duplicate saving, and a short manual ride saving without completion. Changed times were both rgb(180, 35, 24), with line-through on the original. New rarity text uses the normal readable foreground.

Additional Chromium checks passed:

- Manual ride recovery preserves its timer, notes and photo after reload.
- Offline and unavailable-GPS completion still use the session timer.
- A simulated failed storage transaction preserves the form and photo; saving again succeeds.
- Two tabs saving the same ended session together create one entry and remove the draft.
- Reconciliation resolving after an edit preserves the newly saved note and photo.
- Offline reload works with v19; `/v1/health` fails offline rather than returning the application HTML.

The browser harness explicitly waits for initialization and durable draft completion. Early harness runs that did not wait were discarded; only settled final runs are reported above.

## API evidence

Read the official FUTAR OpenAPI on 11 November 2026. Confirmed the futar.bkk.hu base, OTP references, supported v5, epoch-second stop and vehicle times, inline `includeVehicleFromTrip`, scheduled-prediction flag, pickup flag, and `date` for trip-details. Fixtures exercise those contracts, including 18 vehicles in one stop request, mismatched service dates, malformed payloads, outages, rate limits and redaction. The published schema does not establish that historical responses or plates are populated for every service.

No key exists in this task's environment. `python -B backend/server.py` runs at http://127.0.0.1:8000 with an honest unavailable-live-data response. To enable live arrivals, configure `BKK_API_KEY` in the server environment. A Pages/Android release additionally needs a hosted HTTPS backend and its public URL in `data/api.json`; no key belongs in that file or in chat.

## Review disposition

Sonnet 5.5 medium implemented the feature and one bounded correction. Opus 5.5 medium performed one independent source review in `nearby-rides-code-review.md`. The lead checked the findings against source and official schema, generated stop IDs, ran the tests and integrated the corrections. No free reviewers or further review loops were used. Local Strata was offline.

The review's stop-data blocker is resolved locally. Inline vehicles replace the twelve-trip lookup cap. Reconciliation only updates current metadata and has bounded attempts. Duplicate detection is atomic. Unsaved-form replacement is confirmed before mutation. Map pins have letters, shapes and a live legend. Setup jargon and inaccurate untimed-ride wording were removed. Public deployment and authenticated live verification remain open.

## Page and security checklist applicability

Numbers refer to the shared 20-page/50-security checklist. Checked means source or local behavior was examined, not a legal or accessibility certification.

| Items | Assessment and evidence |
| --- | --- |
| 1, 4, 6, 7, 8, 9, 12, 13, 19, 20 | Checked: device-local rides/photos/GPS, Board disclosure and README network description; no marketing collection; image alt text; BKK/OSM attribution; local deletion and backups. |
| 14, 15 | Checked on affected rows/dialogs: readable foreground and red time text; labels independent of color; keyboard and focus scenarios above. Full assistive-technology audit remains open. |
| 2, 3, 5, 10, 11, 16, 17, 18 | Not applicable to this scoped personal ride logger: no sales, accounts, marketing cookies, testimonials, business checkout or email campaign. |
| 21, 22, 23, 31, 32, 34, 35, 36, 39, 41, 42, 43, 47, 48, 55 | Checked locally: server-held key, ignored environment files, redaction, JSON errors, bounded input, textContent, image-data-only imports, static allowlist/traversal rejection, fixed upstream, origin allowlist and rate limits. Relevant Python tests pass. |
| 24, 25, 26, 27, 28, 29, 37, 38, 40, 44, 45, 46, 50, 51, 52, 53, 54, 59, 60, 61, 67, 69 | Not applicable to the current read-only public transit proxy and local browser database: no server accounts, user database, roles, SQL/NoSQL, payments, webhooks, AI features, authentication cookies or tenants. |
| 30, 49, 56, 65 | Checked scope: backend source/tests are not served by the allowlisted server; health exposes only key-presence boolean; fixtures stay in tests; no generated source maps or internal dashboards added. |
| 33, 57, 58 | No new runtime dependencies. Existing Capacitor latest-version dependencies and complete repository-history/dependency audits are outside this feature check. No new credentials added. |
| 62, 63, 66, 68 | Deployment checks remain open: hosting, TLS, production headers, operational logging/monitoring and provider configuration. Local server binds loopback; IndexedDB/backups remain device-accessible, not encrypted storage. |
| 64 | Local backup formats validated and malicious remote photo URLs rejected. An off-machine backup and complete owner restore drill remain owner operations. |
| 70 | One Opus source review, lead integration, official-schema check and behavioral verification recorded above. |

## Remaining physical checks

Ride on actual Android and iPhone devices with location permission changes, app switching, camera handoff, screen lock and battery saving. Check actual Mac Safari rendering and assistive technology. GPS may have gaps when the app is suspended; the timer continues. Reconciliation remains approximate whenever the API no longer has the relevant observations.
