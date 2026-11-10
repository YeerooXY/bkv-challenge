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

## Install on a phone

The app is published with GitHub Pages: https://yeerooxy.github.io/bkv-challenge/

- Android Chrome: menu, then "Install app".
- iPhone Safari: Share, then "Add to Home Screen".

## Catalog

`data/catalog.json` has every official BKK line (from the BKK timetable data, so line numbers and types are exact) and every vehicle plate seen in the live BKK feed. The plate list only grows as the feed is scanned, so it is not the full fleet yet. Rebuild it from the sibling `bkv-tracker` project:

```
python tracker.py routes     # in bkv-tracker: official lines and types
python tracker.py scan       # in bkv-tracker: add vehicles currently on the road
python tools/build_catalog.py
```

When a line number is shared by two modes (tram 4 and its replacement bus 4), the real line wins. MAV/GYSEV trains are left out. Vehicles seen without a line are listed as Other until they are seen on one.

## Checks

`docs/verification/` holds screenshots and notes from the headless browser run.
