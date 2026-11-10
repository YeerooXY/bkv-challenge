"""Which municipality is each line's terminal stop in? Asks OpenStreetMap (Nominatim), slowly, once per stop.

Writes data/terminal_places.json: {"lat,lon": "Budapest" | "Budaörs" | ...}. Rerun after the stop list changes;
stops already known are not asked again. Nominatim allows one request per second.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(__file__).parents[1] / "data"
OUT = DATA / "terminal_places.json"
UA = "bkv-challenge-catalog/1.0 (+https://github.com/YeerooXY/bkv-challenge)"


def key(lat, lon):
    return f"{lat:.4f},{lon:.4f}"


def terminals(stops_json):
    seen = {}
    for dirs in stops_json["lines"].values():
        for d in dirs:
            for i in (0, -1):
                n, lat, lon = stops_json["stops"][d["s"][i]]
                seen[key(lat, lon)] = (n, lat, lon)
    return seen


def place_of(lat, lon):
    q = urllib.parse.urlencode({"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 10, "addressdetails": 1, "accept-language": "hu"})
    req = urllib.request.Request("https://nominatim.openstreetmap.org/reverse?" + q, headers={"User-Agent": UA})
    a = json.load(urllib.request.urlopen(req, timeout=30)).get("address", {})
    return a.get("city") or a.get("town") or a.get("village") or a.get("municipality") or a.get("county") or ""


def main():
    stops_json = json.loads((DATA / "stops.json").read_text(encoding="utf-8"))
    known = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    todo = {k: v for k, v in terminals(stops_json).items() if k not in known}
    print(len(todo), "terminals to look up", flush=True)
    for i, (k, (n, lat, lon)) in enumerate(todo.items()):
        try:
            known[k] = place_of(lat, lon)
        except Exception as e:
            print("fail", n, e, flush=True)
            time.sleep(10)
            continue
        if i % 25 == 0:
            OUT.write_text(json.dumps(known, ensure_ascii=False, indent=0), encoding="utf-8")
            print(i, n, "->", known[k], flush=True)
        time.sleep(1.2)
    OUT.write_text(json.dumps(known, ensure_ascii=False, indent=0), encoding="utf-8")
    print("done", len(known))


if __name__ == "__main__":
    sys.exit(main())
