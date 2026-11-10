"""Build data/catalog.json (official lines + seen vehicle plates).

Inputs come from the sibling bkv-tracker project:
  routes.json     official BKK line numbers and types (python tracker.py routes)
  sightings.json  vehicles seen in the live feed (python tracker.py scan / monitor)

Usage: python tools/build_catalog.py [tracker_dir]
"""
import json
import sys
from pathlib import Path

TRACKER = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parents[2] / "bkv-tracker"
OUT = Path(__file__).parents[1] / "data" / "catalog.json"

# When one line number is used by two modes (e.g. tram 4 and its replacement bus 4), keep the real line.
PRIORITY = ["SUBWAY", "TRAM", "TROLLEYBUS", "HEV", "FERRY", "BUS"]


def main():
    routes = json.load(open(TRACKER / "routes.json", encoding="utf-8"))
    sightings = json.load(open(TRACKER / "sightings.json", encoding="utf-8"))

    lines = {}
    for r in routes.values():
        name, t = r["name"], r["type"]
        if name not in lines or PRIORITY.index(t) < PRIORITY.index(lines[name]):
            lines[name] = t

    plates = {}
    for s in sightings.values():
        plate = (s.get("license_plate") or "").replace(" ", "").upper()
        t = s.get("type", "UNKNOWN")
        if not plate or t == "TRAIN":  # MAV/GYSEV trains are not BKV vehicles
            continue
        names = sorted({routes[r]["name"] for r in s.get("routes_seen_on", []) if r in routes})
        plates[plate] = {"plate": plate, "type": t, "lines": names}

    out = {
        "lines": [{"id": k, "label": k, "type": v} for k, v in sorted(lines.items())],
        "plates": sorted(plates.values(), key=lambda p: p["plate"]),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kinds = {}
    for p in out["plates"]:
        kinds[p["type"]] = kinds.get(p["type"], 0) + 1
    print(len(out["lines"]), "lines,", len(out["plates"]), "plates", kinds, "->", OUT)


main()
