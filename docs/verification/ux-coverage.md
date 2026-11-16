# UX coverage ledger

Updated 2026-11-16 for the implementation of [the screen plan](../screen-plan.md). The compact transit-row direction is captured in [ride-redesign](ride-redesign/). Earlier audits describe the preceding interface and remain historical evidence.

All current checks use Playwright emulation: Windows desktop Chromium, desktop WebKit, Pixel 7 Chromium and iPhone 13 WebKit, each in light and dark themes. Desktop WebKit does not establish real macOS Safari rendering; iPhone emulation does not establish physical iPhone behavior. No physical-device or screen-reader check has been performed.

Evidence:
- R: `tests/browser/ride-redesign.cjs`, screenshots and `ride-redesign/results.json`. Mocked live arrivals, geolocation, trip and vehicle responses; actual app rendering/storage. A synthetic one-pixel photo verifies persistence, not photo appearance. Captures use normal motion; reduced motion is checked through active animations and a second boarding flow.
- E: `tests/browser/recovery.cjs`: reload/photos/notes, offline timer, failed-save retry, simultaneous two-tab save, denied GPS with rider-confirmed endpoints, and legacy missing-plate draft recovery.
- C: `tests/browser/reconciliation.cjs`: editing while API evidence arrives, photo preservation, offline service worker and API-cache exclusion.
- U: 18 Node tests and 42 Python tests, including legacy/new qualification and live-trip metadata.

Every R entry below was checked on 2026-11-16 across all eight profile/theme combinations. Automated axe checks cover WCAG A/AA rules; a clean scan is not a full accessibility audit.

| Screen / state | Layout / visual | Motion | Focus / keyboard | Accessibility | Wording / states |
|---|---|---|---|---|---|
| Ride / Nearby | R capture; compact row, wrapping | Skeleton finite; reduced-motion static | Row Enter, close Escape, Tab/Shift+Tab to Board | R axe | Direct Board; loading code inspected; success tested; live failure E partial |
| Vehicle details / map | R dialog exercised; map provider deliberately disabled | Dialog static | R close restores opener | Manual screen-reader: never | Missing-provider fallback exercised; real tiles not verified |
| Active ride | R capture | 200 ms entry; reduced-motion boarding has no animation | Board focuses heading; Space boards; Undo returns Nearby | R axe | Timer, photo, End; E reload/offline/storage checks |
| Active ride elsewhere | R Resume visibility and navigation | 180 ms entry; no infinite animation under reduce | Resume focuses heading | Manual audit: never | Plate/timer; reload preserved |
| Finish ride | R capture; fixed Save above navigation | 200 ms entry; capture waits for settle | End focuses Save; missing photo focuses Add photo | R axe | Confirm/correct stops; E failed save retains draft |
| Saved result | R capture | Static | Save focuses result; Nearby focuses list heading | R axe | Completion result; one entry per session R/E |
| Lines | R capture; no horizontal overflow | Inventory loops removed; reduced-motion scan | Navigation and details opener exercised | R axe | Grouping and filter disclosure reviewed; filter combinations partial |
| Line 225 details / fleet | R capture with reported location and Board | Loading skeleton finite | Close retains logical focus | R axe | Fresh-trip boarding exercised; mock single-vehicle result |
| Plates | R capture; compact rows | Inventory loops removed | Navigation exercised; all filters keyboard: never | R axe | Explicit lookup; full combinations not tested |
| Plate details / live match | Shared lookup inspected; no separate current capture | Shared static dialog | Current plate-specific path: never | Current plate-specific scan: never | Stale/not-reporting messages inspected; full states not exercised |
| History | R capture; collapsed details | Static | Navigation exercised | R axe | New qualification wording; no-photo legacy fixtures partial |
| Ride details / edit | E/C scripted editing, photo retention | Static | Automated edit/cancel partial | Dedicated axe: never | Reconciliation preserves concurrent edits; delete/backup restoration not rerun |
| Progress | R capture; compact overall/mode summaries | No looping inventory effects | Navigation exercised | R axe | Totals render; all-empty/failed-catalog states not exercised |
| Settings / backup | R capture; theme applied | Static | Theme select exercised; complete backup keyboard: never | R axe | Location/privacy disclosure reviewed; backup/import round trip not rerun |
| Camera sheet | R cancel exercised; draft retained | Static | Cancel returns Add photo | Dedicated axe: never | Missing-photo recovery tested; native camera denial: never |
| Catch overlay | Removed from normal save path | Existing decorative loops disabled | Not part of normal flow | Dedicated current audit: never | Saved result replaces blocking celebration |

Remaining physical checks: Android APK camera/permissions, screen lock/resume, native safe areas and enlarged text; real macOS/iOS Safari font rendering; VoiceOver/TalkBack; touch while walking. Real map tiles, unknown/likely identity interaction, full filter combinations, backup round trips and every empty/error branch need dedicated follow-up coverage. These are not claimed as passed by the screenshots.
