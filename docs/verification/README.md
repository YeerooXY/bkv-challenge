# Verification record, 2026-11-10

Run: headless Playwright against a local static server. All four profiles were emulated; none was a real device.

| Profile | Engine | Result |
|---|---|---|
| PC | Chromium 1280x800 | pass |
| Mac | WebKit 1440x900 | pass (WebKit engine, not real macOS Safari) |
| Android | Chromium, Pixel 7 profile | pass |
| iPhone | WebKit, iPhone 14 profile | pass (WebKit engine, not real iOS Safari) |

Checked on each: save without a photo is blocked with a message and focus moves to the photo field; with a photo the ride saves, focus returns to the Line field; the saved line and plate leave the Missing views; Progress and Daily update; no horizontal overflow; no console errors.

Not checked: real-device fonts and rendering, camera capture, installing to the home screen, the iOS datetime picker.

An early run failed in WebKit because Blobs were stored directly in IndexedDB; photos are now stored as raw bytes.
