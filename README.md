# BKV Challenge

A phone-first log for "A Nagy BKV Kihívás": ride every Budapest line and every individual vehicle (by license plate), with a photo for each ride.

Plain HTML, CSS and JS. No build step. Logging, plates, lines and history work offline once opened. Nearby arrivals need a small key-protected service (`backend/server.py`, see Nearby arrivals).

## What it does

- **Log**: line, license plate, time (filled with now), stops travelled, one or more photos (required), and notes on how the vehicle looks and feels.
- **Lines / Plates**: everything not ridden yet, grouped by type, with type filters and search. A saved ride removes its line and plate from these lists.
- **Progress**: overall, lines, plates and per-type bars, plus a daily table of new lines and plates cleared.
- **History**: all rides, newest first, with edit and delete.
- **Backup**: export and import all rides as JSON.

A line counts once ridden end to end. A plate counts once one ride of at least 10 minutes (600 seconds, Board to Get off, one plate) is saved. Rides saved before the ride timer existed keep their credit. A plate or line missing from the catalog is added automatically the first time you log it.

## Nearby arrivals and the ride timer

- **Log, Nearby**: Find vehicles near me lists the vehicles arriving at the platforms around you, soonest first, with line, headsign, plate, New or Completed, and the time. When a live prediction differs from the timetable, the scheduled time is struck through in red and the predicted time follows it in red. Without a prediction the timetable time is shown as Scheduled. A vehicle without a plate reads Plate unavailable and is never New.
- **Tap a row** for the map and details. **Board this vehicle** fills the Log form and starts the ride timer and GPS. **Board now** on the Log screen does the same for a vehicle you pick by hand.
- **Get off** stops GPS, saves the end time and suggests the stop you got off at from your latest GPS point. You confirm or change it. Add a photo and save as usual.
- **The only qualification rule**: at least 600 seconds between Board and Get off, on one plate. 599 does not count. Rides are not added together. A shorter ride still saves. GPS gaps, a locked or hidden screen and internet outages never pause or reduce the timer.
- The timer and GPS points are saved on the device as they happen, so a reload or crash restores the ride. GPS records only while the app is open on screen. After a lock or app switch the track can have gaps; they are not filled in.
- When the internet is back, a saved ride that is under 24 hours old is matched to the API once an hour. A Nearby ride is matched by trip, date, plate and boarding time. A ride boarded by hand with **Board now** is matched by plate, line, direction and boarding stop in the arrivals around the boarding time. A match does not change completion; a missing record leaves the ride unconfirmed, and after 24 hours it stays unconfirmed without further requests. Only the ride's match record is written, never its photos, notes or track. Predicted and scheduled times are never treated as observed departures.
- **Board from Nearby** with an unsaved ride in the Log form asks before replacing it, and the earlier photos and notes are not carried over to the new vehicle.

## Privacy

Rides, photos, ride timers and GPS tracks are stored in the browser's IndexedDB on your phone. Photos are scaled to 1600 px before saving. Export a backup from the Progress tab now and then: clearing browser data deletes the log. A backup contains photos and routes.

Network use: Nearby sends the ids of the selected stops, and later the trip id and service date of a saved ride, or the boarding stop id and boarding time (rounded to the minute) of a ride boarded by hand, to the arrivals service. It never sends your GPS position or plate history. The map loads tiles from the provider in `data/api.json`, which sees the area you view. Nothing else leaves the device.

## Run it

```
set BKK_API_KEY=your_key_here
python backend/server.py
```

Open http://127.0.0.1:8000. This serves the app and the arrivals API (`/v1/arrivals`, `/v1/trip`, `/v1/health`) together. Without `BKK_API_KEY` the app runs and Nearby says live arrivals are unavailable; manual logging is unaffected. The key is read from the environment, goes only to `futar.bkk.hu`, and is never sent to the browser or written to a log. The service allows only those fixed upstream calls, validates and bounds its inputs, shares one cached answer per stop for 20 seconds, and rate limits each client. It asks the FUTAR API (version 5) for each stop with the vehicle of every trip included, so one call per stop returns every plate; the app polls every 30 seconds. FUTAR's schema has no cancellation field, so cancelled trips are not marked.

`python -m http.server 8000` still serves the app alone; Nearby then reports that live arrivals are not set up.

The service worker needs `localhost` or HTTPS.

### Static hosting and the Android app

GitHub Pages and the Capacitor app cannot run the service. Host `python backend/server.py --api-only` somewhere with `BKK_API_KEY` set and `ALLOWED_ORIGINS=https://yeerooxy.github.io`, then set `apiBase` in `data/api.json` to its `https://` address. The key stays on that host. Until `apiBase` is set, Nearby shows that live arrivals are not set up. Nothing is deployed by this repository.

### Stop ids

Nearby finds platforms through the official stop id appended to each stop in `data/stops.json` (and the platforms short turns and branches skip, listed as `x` per direction). Regenerate it with `python tools/update_catalog.py` (set `GTFS_ZIP` to a downloaded timetable to force the rebuild). Without ids Nearby reports that nearby vehicles are not available and points to the Log form. The stop list is rebuilt with one entry per platform, so an unsaved form draft from an older stop list keeps its stop text and starts from the default stops instead of guessing.

### Tests

```
node --test tests/ride-core.test.js
python -I -m unittest discover -s tests -p "test_*.py" -v
```

The Python fixtures are synthetic payloads shaped after the FUTAR schema, not live samples.

## Install on an Android phone

Download the app: https://github.com/YeerooXY/bkv-challenge/releases/latest/download/BKV-Challenge.apk

Open the file and allow installs from your browser when Android asks. Later versions install over the existing app and keep your rides. The app is built and signed by the GitHub Actions workflow `build-apk.yml` (Capacitor wraps the web app); the signing key is stored as repository secrets and never in the repo.

The website also works in a browser and can be added to the home screen: https://yeerooxy.github.io/bkv-challenge/

## Catalog

`data/catalog.json` holds every BKK line and every BKV and Arriva vehicle (Volan buses are left out):

- **Lines**: official numbers, types and colours from the BKK timetable, with rarity, a fact and a few traits for each. Most facts are worked out from the stop list and timetable; `data/line-notes.json` holds hand-written ones.
- **Vehicles**: plates seen in the live BKK feed, plus models, last sign-on and spare vehicles from WinMenetrend, refreshed once a day.
- **Rarity**: plates by days since the last sign-on (3 uncommon, 7 rare, 14 legendary, 30 mythic, 90 artifact) and how few of the model exist; lines by night service, ends outside Budapest (from OpenStreetMap, `data/terminal_places.json`) and very long stop lists. A night line that starts and ends outside Budapest is a nightmare.
- **Photos**: `data/models/` has photos from Wikimedia Commons with credits in `data/model-photos.json` (shown under Progress, Photo credits).

A GitHub Actions job (`.github/workflows/update-catalog.yml`) merges the live feed into the catalog every hour. The BKK API key lives only in the repository secret `BKK_API_KEY`.

```
pip install requests gtfs-realtime-bindings pillow
set BKK_API_KEY=your_key_here
python tools/update_catalog.py     # rebuild the catalog
python tools/places.py             # look up the municipality of new line ends (slow, one per second)
```

When a line number is shared by two modes (tram 4 and its replacement bus 4), the real line wins; trams 4, 6 and 4-6 are rated together. MAV/GYSEV trains are left out.

## Checks

`docs/verification/` holds screenshots and notes from the headless browser run.
