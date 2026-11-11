# Nearby cards and automatic refresh

Verified 2026-11-11 against the screenshot supplied by the owner. The clipped turquoise element was a stop selector; the blank gradient was the empty arrivals container.

Log now selects Nearby by default and requests location/arrivals when opened. Progress remains the landing view. Nearby refreshes every 30 seconds and through Refresh; automatic requests pause outside Nearby, while hidden, during recording and during edits. A missing backend pauses automatic retries until Refresh. Existing manual logging, ride storage, arrival sorting, map and timing helpers are reused.

Vehicle rows fill the available content width with 11px corners, translucent glass fill and a 4px edge using the existing BKK line colour. Existing line, direction, plate status, rarity and time fields remain. Changed predictions show a red struck-through scheduled time beside the red prediction. Stop filters wrap vertically inside a closed disclosure; the empty gradient is removed.

## Work and review

- Build: Sonnet 5.5 medium, claude:default, task e1763913-e18c-4ad8-b1df-a696b012ab0e.
- One review: Opus 5.5 medium, claude:default, task ec9d5f93-a3c6-4fbd-ae3a-92645fd6f5f0. Findings: glass/colour styling, collapsed filters, permanent-error polling, pagination/empty state. See nearby-cards-review.md for the review before correction.
- Bounded correction: Sonnet 5.5 medium, claude:default, task 468dc3f1-a89f-4076-89b5-5f595c570205; all four findings addressed. No escalation or free workers. Local Strata was offline.
- Lead work: browser checks, test maintenance and this verification record.

## Executed checks

- 14 JavaScript and 31 Python tests passed; syntax and git diff checks passed.
- Existing browser flow passed on four profiles: row/map/Board/Get off, photo save, ten-minute completion and short manual rides. Recovery passed for reload, offline completion, failed saves, concurrent tabs and unavailable GPS. Reconciliation retained an edit and photo during a pending request; cache v20 loaded offline and did not substitute HTML for API failures.
- New UI checks passed on Windows Chromium, desktop WebKit, Pixel 7 Chromium, iPhone 13 WebKit and 320px Chromium, in light and dark (10 cases). Checked card/stop widths, long direction wrapping, no horizontal overflow, colour edges, radius, plate/time fields and retained filter focus.
- Controlled clock confirmed one lookup on opening Log, no lookup before 30 seconds, a lookup at 30 seconds and immediate Refresh. Manual mode and other views paused requests. A static HTML response paused automatic retries for 90 seconds; Refresh recovered.
- Screenshots inspected for all four profiles and the narrow viewport. Evidence: nearby-cards/*-rows.png, *-stops.png and results.json. Earlier complete ride/recovery evidence remains in nearby-lead/.

Fixtures are isolated to browser tests. No demonstration vehicles were added to the application. Chromium runs on Windows; Mac/Android/iPhone coverage uses emulated profiles/engines. Actual macOS/iOS font rendering, physical-device GPS and backdrop-filter appearance remain device checks.

Live public arrivals still require the planned Linux backend and its HTTPS apiBase. This UI repair does not deploy that server. The separately requested bus three-stop and metro one-station completion rules remain pending.
