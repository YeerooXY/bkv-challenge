# Code review: nearby arrivals and timed rides (11 November 2026)

Reviewer: Opus 5.5, read-only. Base revision c61f763 plus the uncommitted working tree.

Requirements source: `docs/nearby-rides-decisions.md` and the task acceptance criteria.

## Verdict

The ride rules are sound and match the decisions. Do not ship Nearby yet. On the current data and deployment it cannot produce a single row (finding 1). The remaining blockers are plate coverage and the upstream budget (2), and a reconciliation pass that can overwrite a user's edit (3).

## Evidence available to this review

- Source reading only. This worker had file tools only: no shell, no browser and no network. No test, command or browser check was run here. The FUTÁR OpenAPI YAML was not read in this review.
- Statements about the FUTÁR schema below are marked **unverified**. They must be confirmed against `https://opendata.bkk.hu/docs/futar-openapi.yaml`, which the lead is fetching.
- The diff against c61f763 was not available without git, so this review did not check whether the Plates layout changes survive. The lead's rendered check covers it.

## Confirmed correct by reading the code

- **600-second rule.** `RideCore.qualifies` uses only `boardedAtMs` and `endedAtMs` (`js/ride-core.js:9-12`). GPS, visibility and network state cannot affect it. `rideOff` sets `endedAtMs` before anything else (`js/nearby.js:295`).
- **Legacy and plate rules.** Legacy entries without `ride` keep their credit. A timed ride counts only for `ride.plate`, so changing the plate later does not transfer credit (`js/ride-core.js:16-20`, `js/app.js:966-973`). Manual and untimed rides never count.
- **Required photo.** The required-photo check is still in place (`js/app.js:984`). Saving during a ride is blocked until Get off (`js/app.js:983`).
- **Atomic save.** The entry, extras, the form draft and the session row are written in one transaction. If the transaction fails, the form is kept (`js/app.js:1005-1016`). If a saved session is found again on restore, it is dropped (`js/nearby.js:327`).
- **Arrival times.** A changed time shows the scheduled time struck through in red, then the predicted time in red. It also has a hidden text label (`js/nearby.js:134-138`, `css/app.css:327`). A scheduled-only time is labelled "Scheduled". A stale vehicle report removes the prediction instead of keeping a guess (`backend/futar.py:139-140`).
- **No invented GPS.** The stop suggestion needs a GPS fix under 2 minutes old within 250 m of a later stop (`js/ride-core.js:29-37`).
- **One GPS watch.** `startTrack` returns early when a watch already exists (`js/app.js:916`).
- **Key and server safety.** The key is read from the environment, sent only to the fixed host and redacted in logs. CORS is limited to `ALLOWED_ORIGINS`. Static files are allowlisted and traversal is rejected. The service worker does not handle `/v1` or tiles. Live text is written with `textContent`.
- **Focus.** After a refresh, focus returns to the same row by key. If that row is gone, it moves to a nearby row or the heading. Closing the sheet returns focus to the row (`js/nearby.js:144-149`, `184-189`).

## Findings

### 1. High: Nearby cannot work with the current data and deployment

**Where:** `data/stops.json`, `data/api.json:2`, `js/nearby.js:76`

**Problem:**

- Each stop record in `data/stops.json` has only three columns, for example `["Kelenföld vasútállomás M",47.46447,19.02338]`. With no stop ids, every Nearby search stops at the "no stop ids" message.
- With `apiBase: ""`, the Pages install calls `/v1/...` on GitHub Pages. That returns a 404 HTML page, so the app shows "not set up for this site".

**Fix:**

- Regenerate `data/stops.json` with `tools/gtfs_stops.py` from the public static GTFS. That file already writes the id in column 4 (`tools/gtfs_stops.py:95`).
- Deploy `backend/server.py --api-only` with `BKK_API_KEY` and `ALLOWED_ORIGINS`, then set `apiBase`.

**Regression checks after regenerating:**

- The file now has one row per platform, so stop indices change. `restoreDraft` restores `pick.from` and `pick.to` from an old draft without range checks (`js/app.js:671`). Check that an existing form draft with stop indices still opens without an out-of-range select.
- Check that `data/timetable.json` direction order still matches `lines`.

### 2. High: plates are missing beyond 12 trips, and the upstream budget runs out with two users

**Where:** `backend/futar.py:29`, `:32`, `:34`, `:237-252`; `js/nearby.js:10`

**Missing plates:**

- Only the first 12 trips, sorted by time, get a trip-details lookup.
- Later rows get `attach(r, None)`, so `plate` is null while `state` stays `"ok"`.
- The app then shows "Plate unavailable" for vehicles that may have a plate. The requirement is the actual plate for each vehicle.

**Budget:**

- One poll costs up to 6 stop calls plus 12 trip calls.
- `TTL` (15 s) equals `POLL_MS` (15 s), so most polls miss the cache. One user costs about 72 upstream calls a minute against `UPSTREAM_PER_MIN = 90`.
- With a second user, or reconciliation running, requests hit `upstream-budget`. Whole stops then fail.

**Fix:**

- **Unverified:** check whether the YAML documents `vehicles-for-stop`, which returns vehicles with `tripId` and `licensePlate`. If it does, use one call per stop, join rows by `tripId` and drop the per-trip loop. That is less code and at most 6 calls per poll.
- If it does not, mark rows beyond `MAX_TRIPS` as not looked up and set `partial = True`. Also set `TTL` above the poll interval, for example `TTL = 20` with `POLL_MS = 30000`.

**Check:** add a unit test with 15 trips. The answer must be `partial`, or every row must have its vehicle joined.

### 3. High: reconciliation can overwrite an edit, rewrites photos and never stops retrying

**Where:** `js/nearby.js:351-362`

**Overwritten edits:**

- The `editing` check runs before `await api(...)`.
- If the user opens and saves an edit while the request is in flight, `put("entries", {...e, ...})` writes back the old stops, notes, photos and track. The edit is lost.

**Photo rewrite:** each pass unpacks and repacks every photo of every checked ride.

**Endless retries:**

- An `unconfirmed` ride is rechecked every hour, on every start and every `online` event, with no end.
- `trip-details` returns only the trip's current state. A ride from a past day stays `unconfirmed` forever and keeps using the upstream budget.
- Two passes can run at the same time (start-up plus `online`).

**Fix:**

- After the response, open one `readwrite` transaction on `entries`. `get(e.id)`, skip if the entry is missing or `ride.sessionId` differs, set only `ride.api`, then `put`. Photos stay as stored bytes, so `packPhoto` is no longer needed.
- Skip rides whose `endedAtMs` is more than 24 h old. Record one final `unconfirmed` for them.
- Add a module-level in-flight flag.
- Call `reload()` only when something was written.

**Check:** start an edit, let reconciliation resolve, save the edit. The edit must survive. Rides older than 24 h must make no request.

### 4. Medium: a second tab can save the same ride again

**Where:** `js/nearby.js:255-258`, `js/app.js:999`

**Problem:**

- Tab B restored the session but keeps a stale `entries` list.
- When tab A saves, `rideDone` clears the owner record. Tab B's heartbeat then quietly makes it the owner.
- If tab B gets off and saves, `entryIdForSession(entries, ...)` finds nothing in its stale list, so a second entry is written for the same session.
- A GPS fix in tab B also rewrites the deleted `ride-session` row. `restoreRide` cleans that up on the next load.

**Fix:** in the submit handler, before computing `again` while `rideSession` is set, check that the session row still exists: `if (rideSession && !(await getOne("drafts", SESSION_KEY)))`. If it is gone, call `reload()` and `rideDone()`, and show "This ride was already saved in another tab." This uses existing helpers and adds one read.

**Check:** open two tabs, get off and save in tab A, then save in tab B. There must still be one entry.

### 5. Medium: API field assumptions are unverified, and every mismatch fails quietly

**Where:** `backend/futar.py:20`, `:84`, `:118`, `:127`, `:241`, `:262`

The tests use synthetic payloads built on the same assumptions (`tests/test_futar.py:3`), so they cannot catch a mismatch. Check each item against the YAML:

- **Base and version:** `https://futar.bkk.hu/api/query/v1/ws/otp/api/where/` with `version=4` and `appVersion`. The base matches this reviewer's memory of the public API; this is still **unverified**.
- **Time units:** times are epoch **seconds**, converted with `ms()`.
- **`serviceDate` format:** must be a `yyyymmdd` string.
  - If FUTÁR sends a number or another format, `DATE_RE` sets it to `None`.
  - Every saved ride then lacks `serviceDate`, and reconciliation skips it (`js/nearby.js:355`).
  - `trip-details` is also called without a date.
- **`trip-details` date parameter:** confirm the name. If it is `date` and not `serviceDate`, the server ignores it and returns today's run.
- **Cancellation:** `cancelled`, `canceled` and `trip.cancelled` are guessed. If none of them exists, cancelled trips appear as boardable.
- **Vehicle fields:** `entry.vehicle.vehicleId`, `licensePlate`, `location.lat/lon`, `lastUpdateTime` (seconds) and `bearing`.

**Fix:** correct the names to match the YAML. Replace the hand-made fixtures with the YAML example payloads where they exist. Change the guessed cancellation check to the documented field, or remove it.

### 6. Medium: map markers are told apart only by color

**Where:** `js/minimap.js:33-37`, `css/app.css:332-333`

**Problem:** the stop, vehicle and rider markers are green, red and blue dots with `aria-hidden`, and the map has no legend. The text facts give distances but do not say which dot is which. This fails WCAG 1.4.1 (use of color) for the visual map.

**Fix:** in `nbOpen`, add one line of live text after the map listing only the kinds actually drawn, for example "Green dot: stop. Red dot: vehicle. Blue dot: you." A letter inside each pin would also work. Do not add callout lines or pointers.

**Check:** the map sheet in each of the four profiles, with and without the rider's position.

### 7. Medium: Board quietly replaces the unsaved form but keeps its old photos

**Where:** `js/nearby.js:221-230`

**Problem:**

- The confirm prompt only covers an existing GPS track.
- Nearby Board overwrites line, plate, time and stops. Photos and notes from an earlier unsaved ride stay, so the required photo can belong to a different vehicle.
- The form is changed before the session is written. If `put` fails, the user has lost the earlier form content and no ride has started.

**Fix:**

- Widen the confirm prompt to cover a non-empty plate, line or photo list, for example "Replace the unsaved ride in the form?"
- Move `trackPts = []` and `applyBoarding` after a successful `put("drafts", ...)`. The session object `s` does not depend on the form for Nearby.

**Check:** fill the form with a photo, board from Nearby, then cancel the prompt. Nothing must change. Then make storage fail. The form must stay intact.

### 8. Low: wording and small display errors

**Where:** `js/nearby.js:26-27`, `:130`, `:159`

**Changes:**

| Location | Current | Change to |
|---|---|---|
| `js/nearby.js:27` (`NB_TEXT.stops`) | "Rebuild data/stops.json (see the README)." | "Nearby vehicles are not available yet." The rider gets setup instructions they cannot act on. Keep the README note for maintainers. |
| `js/nearby.js:26` (`NB_TEXT.nokey`) | "...the service has no BKK key." | "Live arrivals are not available right now." |
| `js/nearby.js:130` | "Logged, under 10 min" | "Logged without a 10-minute ride". A manual untimed entry was never timed, so the current text is wrong for it. |
| `js/nearby.js:159` | "0 min early" for a vehicle under 30 s early | Use seconds under one minute, as the late branch already does. |

No banned patterns ("not just X", slogans, decorative labels) were found in the new strings.

## Smaller notes (fix only if cheap)

- **Legacy credit after a plate round trip.** Editing a legacy entry to a different plate and then back loses its legacy credit for good, because `editing.ride` is now an untimed record (`js/app.js:971`). This is rare. A fix would need a marker on the record.
- **Import bypass.** Deleting `ride` from a backup gives legacy credit on import. A client-only app cannot prevent this. Treat it as a known limit, not a defect.
- **Field limits differ.** `validArrival` allows a `tripId` up to 100 characters (`js/nearby.js:49`), but import allows 80 (`js/ride-core.js:90`). A longer id would make the whole backup impossible to import. Use 80 in both places.
- **`toTouched` not saved.** It is set without `saveSession()` (`js/nearby.js:313`). After a reload mid-ride, Get off may overwrite a stop the user chose. Call `saveSession()` in that listener.
- **Platforms outside the canonical list.** Boarding at one of these sets `pick.edited = true` (`js/nearby.js:214`). Get off then says "Your stop list is kept as you set it" even though the user set nothing.
- **Map snapshot.** The map is fixed when the sheet opens. Its text gives the time of the vehicle position, which is acceptable.
- **"Next stops" goes one way.** It never returns to the first page; the only way back is a new search.
- **Errors outside `stop_rows`.** A non-dict `references.trips` (`backend/futar.py:99`) raises an error that is not an `ApiError`, which turns the whole request into a 500. Optional: catch `(TypeError, AttributeError)` there and turn them into `upstream-bad-response`.

## Regression checks for the lead's run

1. `node --test tests/ride-core.test.js` and `python -I -m unittest discover -s tests -p "test_*.py" -v`.
2. **Ride timing:**
   - Board, wait under 600 s, Get off and save: the plate is not completed.
   - Repeat at 600 s or more: the plate is completed.
   - Repeat with GPS denied and offline: the result is the same.
3. **Reload mid-ride:**
   - The timer continues from boarding.
   - The status mentions the missing GPS points.
   - Photos in the form draft survive.
4. **Save twice:** save the same session twice, including after a reload. There must be one entry.
5. **Plates:**
   - Edit a timed entry's plate: credit is removed.
   - Edit a legacy entry without changing the plate: credit is kept.
6. **Import and export:** export, then import into an empty profile. Rides keep `ride` and keep the same credit.
7. **Arrival rows:**
   - A changed time is struck through in red, followed by red.
   - Scheduled-only rows are labelled "Scheduled".
   - Rows without a plate say so.
   - Cancelled rows cannot be boarded.
8. **Focus:**
   - After a 15 s refresh, focus stays on the same row.
   - After closing the sheet, it is on the row.
   - After Board, it is on the ride title.
   - After Get off, it is on the end stop.
   - A removed row moves focus to a nearby row, never the page body. Check with Tab, Shift+Tab, Enter and Space.
9. **GPS watch:** the number of active watches never exceeds one after visibility changes and a tab takeover.
10. **Plates layout:** compare the Plates view with c61f763 to confirm that the earlier layout changes are still in place.
