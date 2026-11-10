"""Update data/catalog.json from the BKK feeds.

- Lines: official BKK timetable (data/routes.json, refreshed weekly) with their colors,
  plus the stops of every line in both directions (data/stops.json).
- Plates: vehicles in the live feed are merged in; plates are never removed.

Needs the BKK_API_KEY environment variable (https://opendata.bkk.hu/).
Usage: python tools/update_catalog.py   (GTFS_ZIP=path reuses a downloaded timetable and forces a refresh)
"""
import csv
import io
import json
import os
import sys
import zipfile
from datetime import date
from pathlib import Path

import requests
from google.transit import gtfs_realtime_pb2

sys.path.insert(0, str(Path(__file__).parent))
import gtfs_stops

ROOT = Path(__file__).parents[1]
CATALOG = ROOT / "data" / "catalog.json"
ROUTES = ROOT / "data" / "routes.json"
FEED_URL = "https://go.bkk.hu/api/query/v1/ws/gtfs-rt/full/VehiclePositions.pb"
GTFS_URL = "https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip"
TYPES = {"3": "BUS", "0": "TRAM", "11": "TROLLEYBUS", "109": "HEV", "1": "SUBWAY", "4": "FERRY"}
# When one line number is used by two modes (tram 4 and its replacement bus 4), keep the real line.
PRIORITY = ["SUBWAY", "TRAM", "TROLLEYBUS", "HEV", "FERRY", "BUS"]
REFRESH_DAYS = 7


def load_routes():
    local = os.environ.get("GTFS_ZIP")
    if not local and ROUTES.exists():
        data = json.loads(ROUTES.read_text(encoding="utf-8"))
        fresh = (date.today() - date.fromisoformat(data["fetched"])).days < REFRESH_DAYS
        if fresh and "color" in next(iter(data["routes"].values())) and gtfs_stops.OUT.exists():
            return data["routes"]
    if local:
        raw = Path(local).read_bytes()
    else:
        resp = requests.get(GTFS_URL, timeout=300)
        resp.raise_for_status()
        raw = resp.content
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        rows = csv.DictReader(io.TextIOWrapper(z.open("routes.txt"), encoding="utf-8-sig"))
        routes = {
            r["route_id"]: {"name": r["route_short_name"], "type": TYPES.get(r["route_type"], "UNKNOWN"),
                            "color": r["route_color"] or "009EE3", "text": r["route_text_color"] or "FFFFFF"}
            for r in rows
        }
        n_lines, n_stops = gtfs_stops.build(z, routes)
        print(f"stops: {n_lines} lines, {n_stops} stops")
    ROUTES.write_text(json.dumps({"fetched": date.today().isoformat(), "routes": routes}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return routes


def feed_vehicles(key):
    resp = requests.get(f"{FEED_URL}?key={key}", timeout=60)
    resp.raise_for_status()
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(resp.content)
    for e in feed.entity:
        if e.HasField("vehicle"):
            v = e.vehicle
            plate = v.vehicle.license_plate.replace(" ", "").upper()
            route = v.trip.route_id if v.HasField("trip") else ""
            if plate:
                yield plate, route


def main():
    key = os.environ.get("BKK_API_KEY")
    if not key:
        sys.exit("Set BKK_API_KEY first.")
    routes = load_routes()

    lines = {}
    for r in routes.values():
        if r["name"] not in lines or PRIORITY.index(r["type"]) < PRIORITY.index(lines[r["name"]]["type"]):
            lines[r["name"]] = r

    old = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.exists() else {"plates": []}
    plates = {p["plate"]: p for p in old["plates"]}
    added = 0
    for plate, route in feed_vehicles(key):
        if route and route not in routes:
            continue  # MAV/GYSEV trains are not BKV vehicles
        p = plates.get(plate)
        if p is None:
            p = plates[plate] = {"plate": plate, "type": "UNKNOWN", "lines": []}
            added += 1
        if route:
            p["type"] = routes[route]["type"]
            if routes[route]["name"] not in p["lines"]:
                p["lines"] = sorted(p["lines"] + [routes[route]["name"]])

    out = {
        "lines": [{"id": k, "label": k, "type": v["type"], "color": v["color"], "text": v["text"]} for k, v in sorted(lines.items())],
        "plates": sorted(plates.values(), key=lambda p: p["plate"]),
    }
    CATALOG.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out['lines'])} lines, {len(out['plates'])} plates, {added} new")


main()
