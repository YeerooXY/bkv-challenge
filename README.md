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

`data/catalog.json` lists known lines and plates. It was built from the live BKK vehicle feed by the sibling `bkv-tracker` tool:

```
python tools/build_catalog.py [path/to/sightings.json]
```

Line numbers are derived from BKK internal route ids and are approximate. Trolleybus lines are not tagged yet, so they show under Other until they appear in a feed scan. Types TRAIN and UNKNOWN also show under Other.

## Checks

`docs/verification/` holds screenshots and notes from the headless browser run.
