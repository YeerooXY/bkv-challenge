# Nearby automatic cards repair: code review

Date: 2026-11-11. Reviewer: Opus 5.5 (read-only, source only). Base revision 84ecc2e plus the uncommitted Sonnet patch (task e1763913).
Scope: `js/nearby.js` (state, api errors, nbFind, nbAuto, nbPoll, nbStopChips, nbLoad, nbRows, restoreRide, nbSetMode, nearbyView), `css/app.css:307-328`, `index.html:16-42`, `sw.js` (cache v20), `js/app.js` show/render/locate.
No browser was run. Every rendering statement below comes from reading the source.

## Verdict

**Needs changes before acceptance.** The trigger and gating logic is mostly correct. The default mode, the busy guard, the seq guard, the visibility, recording and edit gates, and focus fallback to `#nb-title` all hold. Four material problems remain. The cards drop the requested glass look. The tall stop list still pushes the cards below the fold. With no backend, the app polls GPS and the API every 30 s, which can never succeed. Pagination and failure can produce a contradictory empty message.

## What holds

- Default mode: `nb.mode = "nearby"` (`js/nearby.js:15`). `restoreRide` switches to `form` only when a ride exists (`:386`), and `nearbyView` does the same for a ride or an edit (`:401`). Progress stays the landing view because `show()` hides the other views before `render()` → `nearbyView` (`js/app.js:208-216`), so the first lookup runs only on entering Log.
- Gating: `nbAuto` returns for non-Log, hidden Log view, hidden document, recording, editing and busy (`:91`). `nbPoll` clears the timer when the mode is not Nearby or Log is hidden (`:127`). Hidden-tab ticks are no-ops, and the `visibilitychange` handler (`:405`) refreshes only when the data is stale.
- No overlap from auto or Refresh: `nb.busy` (`:76`). Stale responses are dropped by `nb.seq` (`:114`, `:120`).
- Drafts: Nearby never writes form controls. Focus falls back to `#nb-title`, never the body (`:104`, `:161`).
- Denied GPS: `nb.pos` stays null, so no timer starts (`:80`, `:127`), and the message names the recovery step.
- `sw.js:1` bumps to `bkv-challenge-v20`, and `data/api.json` is precached.

## Findings

### 1. Opaque cards drop the requested glass appearance and BKK color coding (high)
`css/app.css:314-315`: `.nb-row` uses `background:var(--card)` (opaque white or `#141c1b`) with a plain border. The owner asked for stacked, content-width glass cards with slight rounding and BKK color coding. Line color now appears only in the small `badge()` (`js/nearby.js:151`). The patch removes the effect the owner asked for.
**Minimal fix:** use a translucent fill such as `color-mix(in srgb,var(--card) 72%,transparent)` with `backdrop-filter:blur(12px)` and `-webkit-backdrop-filter` (iOS Safari). Inside `@supports not (backdrop-filter:blur(1px))`, fall back to `var(--card)`. In `nbRow`, add `b.style.setProperty("--line-c", <bg from lineColors()>)` and draw `border-left:4px solid var(--line-c)`. Check text contrast on the translucent fill in light and dark themes.

### 2. Six full-width stop buttons push the vehicle cards off the first screen (medium)
`css/app.css:309-310` makes `.nb-stops` a column of six 44 px+ buttons. Each label is long: name, distance and up to three headsigns (`js/nearby.js:99-100`), so buttons wrap to two or three lines. On a phone, Refresh, the status line, the helper text and the six buttons fill the screen before the first card. This replaces the old clipped horizontal row with the opposite problem.
**Minimal fix:** wrap `#nb-stops-h` and `#nb-stops` in a closed `<details>`, as the existing `#ride-note-gps` already does. Use a live summary such as "Stops: 4 of 6 shown" and set it in `nbStopChips`. Chip focus preservation keeps working because focus stays inside the open `details`. Do not redesign the filter.

### 3. With no backend, the app polls GPS and the API every 30 s indefinitely (medium)
`data/api.json` has `apiBase: ""`. `api()` therefore requests `/v1/arrivals` from the static host and throws `absent` (`:40`). `nbFind` still calls `nbPoll()` after the failure (`:86`). Every 30 s the interval re-runs `locate()` with `enableHighAccuracy` (`js/app.js:865`) and fetches again, even though the failure is permanent until a deploy. This costs battery and GPS. It also rewrites the `aria-live` status every 30 s, as do successful polls (`:117`), so screen readers hear repeated announcements.
**Minimal fix:** in `nbLoad`'s catch, when `nb.failed` is `absent`, `config` or `nokey`, clear `nb.timer` and skip further automatic lookups until Refresh. A small check in `nbAuto` is enough. On successful auto polls, update `nb-status` only when the text changes.

### 4. A failure or page switch can show "Nothing arriving" next to an error (medium)
`nbRows` shows "Nothing arriving at the selected stops." whenever `nb.at` is set and the page has no matching arrivals (`:160`). The "Next stops" button (`:398`) changes `nb.offset` and calls `nbLoad(true)` directly. It also bypasses `nb.busy`. If that request fails, `nb.arrivals` still holds the previous page, so the filter empties the list. The rider then sees the empty-state message under a failure status, which is false. Until the response arrives, the cards belong to the previous page while the chips show the new one. "Next stops" also hides on the last page (`:105`), so the first stops are only reachable after the stop set changes.
**Minimal fix:** show the empty message only when `!nb.failed`. Call `nbRows()` in `nbLoad`'s `first` branch so the cards clear with the chips. On the last page, make the button wrap to offset 0 with the label "First stops" instead of hiding it.

## Regression tests the lead should run (Chromium and WebKit, light and dark)

1. Cold start lands on Progress. Opening Log shows Nearby and starts one request. Open the Network panel and confirm no duplicate when visibility changes while the request is in flight.
2. With `apiBase ""`, the error status appears with no blank card or gradient box. Confirm no further GPS or fetch after the failure (needs finding 3).
3. Deny GPS: one clear message, no interval, and Refresh retries.
4. Mocked API in the test harness only: cards show line, headsign, plate, New/Completed, ETA, a red struck-through scheduled time and a red predicted time. Check the glass fill and line color in both themes, and that 390 px and 360 px widths do not overflow.
5. Stop filter: Tab, Shift+Tab, Enter and Space toggle a chip. Focus stays on the chip after a re-render and after a 30 s poll. `document.activeElement` is never `body`.
6. "Next stops" until the last page, then back to the first; a failed page shows no "Nothing arriving".
7. Board, then the timer. While recording, no polls. After Get off the mode is the form and the draft fields are intact. Edit an entry, then Log: the mode is the form.
8. Hide the tab for over 30 s, then return: exactly one refresh.

Emulated WebKit does not establish iOS `backdrop-filter` rendering or real GPS-prompt behavior. Record those as real-device checks.
