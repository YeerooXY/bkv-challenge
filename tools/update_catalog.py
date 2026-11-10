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

from datetime import datetime
import requests
from google.transit import gtfs_realtime_pb2

sys.path.insert(0, str(Path(__file__).parent))
import gtfs_stops
import models
import rarity

ROOT = Path(__file__).parents[1]
CATALOG = ROOT / "data" / "catalog.json"
ROUTES = ROOT / "data" / "routes.json"
MODELS = ROOT / "data" / "models.json"
FEED_URL = "https://go.bkk.hu/api/query/v1/ws/gtfs-rt/full/VehiclePositions.pb"
GTFS_URL = "https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip"
TYPES = {"3": "BUS", "0": "TRAM", "11": "TROLLEYBUS", "109": "HEV", "1": "SUBWAY", "4": "FERRY"}
# When one line number is used by two modes (tram 4 and its replacement bus 4), keep the real line.
PRIORITY = ["SUBWAY", "TRAM", "TROLLEYBUS", "HEV", "FERRY", "BUS", "OTHER"]
REFRESH_DAYS = 7


def special(routes):
    """MOZG is BKK's transport service for people with reduced mobility, not a public bus line."""
    for r in routes.values():
        if r["name"] == "MOZG":
            r["type"] = "OTHER"
    return routes


def load_routes():
    return special(_load_routes())


def _load_routes():
    local = os.environ.get("GTFS_ZIP")
    if not local and ROUTES.exists():
        data = json.loads(ROUTES.read_text(encoding="utf-8"))
        fresh = (date.today() - date.fromisoformat(data["fetched"])).days < REFRESH_DAYS
        if fresh and "color" in next(iter(data["routes"].values())) and gtfs_stops.OUT.exists() and gtfs_stops.SERVICE.exists() and gtfs_stops.TIMETABLE.exists():
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


def load_models():
    """Plate -> model family and type from WinMenetrend, fetched at most once a day."""
    if MODELS.exists():
        cached = json.loads(MODELS.read_text(encoding="utf-8"))
        if cached["fetched"] == date.today().isoformat():
            return cached["v"]
    try:
        v = models.fetch_models()
    except Exception as e:  # keep the last copy when the site is unreachable
        print("models: fetch failed:", e)
        return json.loads(MODELS.read_text(encoding="utf-8"))["v"] if MODELS.exists() else {}
    MODELS.write_text(json.dumps({"fetched": date.today().isoformat(), "v": v}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("models:", len(v), "vehicles")
    return v


def budapest_hour():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/Budapest")).hour
    except Exception:  # no time zone database (plain Windows): Budapest is UTC+1 in winter
        return (datetime.utcnow().hour + 1) % 24


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

    old = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.exists() else {"plates": [], "lines": []}
    plates = {p["plate"]: p for p in old["plates"]}
    line_hours = {l["id"]: l.get("h") or [0] * 24 for l in old.get("lines", [])}
    hour = budapest_hour()
    added = 0
    mod = load_models()  # the authority on which vehicles belong: BKV buses, trams and trolleybuses (no Volan, no trains)
    for plate, route in feed_vehicles(key):
        if route and route not in routes:
            continue  # MAV/GYSEV trains are not BKV vehicles
        if mod and plate not in mod:
            continue  # Volan buses and test devices run on BKK lines but are not collected
        p = plates.get(plate)
        if p is None:
            p = plates[plate] = {"plate": plate, "type": "UNKNOWN", "lines": []}
            added += 1
        p.setdefault("h", [0] * 24)[hour] += 1  # sightings by hour of day
        if route:
            line_hours.setdefault(routes[route]["name"], [0] * 24)[hour] += 1
            p["type"] = routes[route]["type"]
            if routes[route]["name"] not in p["lines"]:
                p["lines"] = sorted(p["lines"] + [routes[route]["name"]])

    # Models: label known plates and add vehicles the live feed has not shown yet.
    for plate, info in mod.items():
        p = plates.get(plate)
        if p is None:
            p = plates[plate] = {"plate": plate, "type": info["t"], "lines": []}
            added += 1
        p["m"] = info["m"]
        p["ll"] = info.get("ll", "")
        if p.get("type", "UNKNOWN") == "UNKNOWN" or info["t"] == "OTHER":
            p["type"] = info["t"]

    if mod:
        plates = {k: v for k, v in plates.items() if k in mod}  # drops Volan buses and vehicles no longer listed

    # Rarity. Lines: night service, terminals out in the agglomeration, few trips. Plates: few vehicles of the model, long idle.
    stops_json = json.loads(gtfs_stops.OUT.read_text(encoding="utf-8"))
    svc = json.loads(gtfs_stops.SERVICE.read_text(encoding="utf-8"))
    line_tier, line_why = {}, {}
    for lid, dirs in stops_json["lines"].items():
        wd = svc.get(lid, {}).get("wd", [0] * 24)
        total = sum(wd) or 1
        night = sum(wd[h] for h in (23, 0, 1, 2, 3, 4)) / total
        ends = [stops_json["stops"][d["s"][i]][0] for d in dirs for i in (0, -1)]
        line_tier[lid], line_why[lid] = rarity.line_rarity(wd, ends, night)
    per_model = {}
    for info in mod.values():
        per_model[info["m"]] = per_model.get(info["m"], 0) + 1
    for plate, p in plates.items():
        info = mod.get(plate)
        if info:
            p["r"] = rarity.plate_rarity(per_model[info["m"]], info.get("ll"), info.get("h", False))

    out = {
        "lines": [{"id": k, "label": k, "type": v["type"], "color": v["color"], "text": v["text"], "h": line_hours.get(k, [0] * 24), "r": line_tier.get(k, 0), "rw": line_why.get(k, [])} for k, v in sorted(lines.items())],
        "plates": sorted(plates.values(), key=lambda p: p["plate"]),
    }
    CATALOG.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out['lines'])} lines, {len(out['plates'])} plates, {added} new")


main()
