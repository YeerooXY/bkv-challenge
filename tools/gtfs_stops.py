"""Build data/stops.json: the stop sequence of every line, both directions, from the BKK GTFS timetable.

Format: {"stops": [[name, lat, lon], ...],
         "lines": {"198": [{"to": "headsign", "s": [stop index, ...]}, ...]}}
Called by update_catalog.py when it downloads the timetable.
"""
import csv
import io
import json
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).parents[1] / "data" / "stops.json"
PRIORITY = ["SUBWAY", "TRAM", "TROLLEYBUS", "HEV", "FERRY", "BUS"]
SAMPLES = 14  # trips sampled per route and direction; the longest one is the full route


def rows(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))


def build(z, routes):
    """z: open ZipFile of the GTFS feed; routes: {route_id: {"name","type",...}}."""
    # Which route ids make up each line (the real mode wins when a number is shared).
    best = {}
    for r in routes.values():
        if r["name"] not in best or PRIORITY.index(r["type"]) < PRIORITY.index(best[r["name"]]):
            best[r["name"]] = r["type"]
    line_of = {rid: r["name"] for rid, r in routes.items() if best[r["name"]] == r["type"]}

    trips = defaultdict(list)  # (line, direction) -> [(trip_id, headsign)]
    for t in rows(z, "trips.txt"):
        line = line_of.get(t["route_id"])
        if line:
            trips[(line, t["direction_id"] or "0")].append((t["trip_id"], t["trip_headsign"]))
    wanted = {}  # trip_id -> (line, direction, headsign)
    for key, lst in trips.items():
        step = max(1, len(lst) // SAMPLES)
        for trip_id, head in lst[::step][:SAMPLES]:
            wanted[trip_id] = (key[0], key[1], head)

    seqs = defaultdict(list)
    for r in rows(z, "stop_times.txt"):
        if r["trip_id"] in wanted:
            seqs[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))

    longest = {}  # (line, direction) -> (headsign, [stop ids])
    for trip_id, seq in seqs.items():
        line, direction, head = wanted[trip_id]
        ids = [s for _, s in sorted(seq)]
        if (line, direction) not in longest or len(ids) > len(longest[(line, direction)][1]):
            longest[(line, direction)] = (head, ids)

    stops_info = {s["stop_id"]: s for s in rows(z, "stops.txt")}
    index, stops = {}, []
    lines = defaultdict(list)
    for (line, direction), (head, ids) in sorted(longest.items()):
        out = []
        for sid in ids:
            s = stops_info.get(sid)
            if not s:
                continue
            if sid not in index:
                index[sid] = len(stops)
                stops.append([s["stop_name"], round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5)])
            out.append(index[sid])
        lines[line].append({"to": head, "s": out})
    OUT.write_text(json.dumps({"stops": stops, "lines": lines}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(lines), len(stops)
