# BKV Challenge

A phone-first log for "A Nagy BKV Kihívás": ride every Budapest line and every individual vehicle (by license plate), with a photo for each ride.

Plain HTML, CSS and JS. No build step, no backend, works offline once opened.

## What it does

- **Log**: line, license plate, time (filled with now), stops travelled, one or more photos (required), and notes on how the vehicle looks and feels.
- **Lines / Plates**: everything not ridden yet, grouped by type, with type filters and search. A saved ride removes its line and plate from these lists.
- **Progress**: overall, lines, plates and per-type bars, plus a daily table of new lines and plates cleared.
- **History**: all rides, newest first, with edit and delete.
- **Backup**: export and import all rides as JSON.

A line or plate counts as cleared once one saved ride names it. A plate or line missing from the catalog is added automatically the first time you log it.

## Privacy

Rides and photos are stored in the browser's IndexedDB on your phone. Nothing is uploaded. Photos are scaled to 1600 px before saving. Export a backup from the Progress tab now and then: clearing browser data deletes the log.

## Run it

```
python -m http.server 8000
```

Open http://localhost:8000. The service worker needs `localhost` or HTTPS.

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
