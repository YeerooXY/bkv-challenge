"""Build data/stops.json: the stop sequence of every line, both directions, from the BKK GTFS timetable.

Format: {"stops": [[name, lat, lon, official stop id], ...],
         "lines": {"198": [{"to": "headsign", "s": [stop index, ...], "x": [other stop index, ...]}, ...]}}
"s" is the ordered longest trip. "x" lists platforms of that direction that trip skips (optional).
Called by update_catalog.py when it downloads the timetable.
"""
import csv
import io
import json
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).parents[1] / "data" / "stops.json"
SERVICE = Path(__file__).parents[1] / "data" / "service.json"
TIMETABLE = Path(__file__).parents[1] / "data" / "timetable.json"
# Typical days used for "trips per hour": a Tuesday, a Saturday and a Sunday without holidays.
DAYS = {"wd": "20261117", "sa": "20261121", "su": "20261122"}
PRIORITY = ["SUBWAY", "TRAM", "TROLLEYBUS", "HEV", "FERRY", "BUS", "OTHER"]
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

    active = {k: set() for k in DAYS}  # day type -> service ids running that day
    for r in rows(z, "calendar_dates.txt"):
        for k, d in DAYS.items():
            if r["date"] == d and r["exception_type"] == "1":
                active[k].add(r["service_id"])

    trips = defaultdict(list)  # (line, direction) -> [(trip_id, headsign)]
    trip_info = {}  # trip_id -> (line, service_id) for the departures-per-hour count
    for t in rows(z, "trips.txt"):
        line = line_of.get(t["route_id"])
        if line:
            trips[(line, t["direction_id"] or "0")].append((t["trip_id"], t["trip_headsign"]))
            trip_info[t["trip_id"]] = (line, t["service_id"], t["direction_id"] or "0")
    wanted = {}  # trip_id -> (line, direction, headsign)
    for key, lst in trips.items():
        step = max(1, len(lst) // SAMPLES)
        for trip_id, head in lst[::step][:SAMPLES]:
            wanted[trip_id] = (key[0], key[1], head)

    seqs = defaultdict(list)
    served = defaultdict(set)  # (line, direction) -> every stop id any trip of it calls at
    first = {}  # trip_id -> (stop_sequence, departure hour)
    for r in rows(z, "stop_times.txt"):
        tid = r["trip_id"]
        if tid in wanted:
            seqs[tid].append((int(r["stop_sequence"]), r["stop_id"]))
        if tid in trip_info:
            served[(trip_info[tid][0], trip_info[tid][2])].add(r["stop_id"])
            seq = int(r["stop_sequence"])
            if tid not in first or seq < first[tid][0]:
                first[tid] = (seq, int(r["departure_time"][:2]) % 24, int(r["departure_time"][3:5]))

    service = defaultdict(lambda: {k: [0] * 24 for k in DAYS})
    deps = defaultdict(lambda: {k: defaultdict(list) for k in DAYS})  # (line, direction) -> day -> hour -> [minutes]
    for tid, (_, hour, minute) in first.items():
        line, sid, direction = trip_info[tid]
        for k in DAYS:
            if sid in active[k]:
                service[line][k][hour] += 1
                deps[(line, direction)][k][hour].append(minute)
    SERVICE.write_text(json.dumps(service, separators=(",", ":")), encoding="utf-8")

    longest = {}  # (line, direction) -> (headsign, [stop ids])
    for trip_id, seq in seqs.items():
        line, direction, head = wanted[trip_id]
        ids = [s for _, s in sorted(seq)]
        if (line, direction) not in longest or len(ids) > len(longest[(line, direction)][1]):
            longest[(line, direction)] = (head, ids)

    stops_info = {s["stop_id"]: s for s in rows(z, "stops.txt")}
    index, stops = {}, []
    lines = defaultdict(list)
    def stop_index(sid):
        s = stops_info.get(sid)
        if not s:
            return None
        if sid not in index:
            index[sid] = len(stops)
            # Columns 0-2 are what the app and tools have always read; the official stop id (a platform) is appended.
            stops.append([s["stop_name"], round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5), sid])
        return index[sid]

    for (line, direction), (head, ids) in sorted(longest.items()):
        out = [i for i in map(stop_index, ids) if i is not None]
        # Platforms the sampled longest trip skips (short turns, branches) of the same direction: nearby search only.
        extra = [i for i in map(stop_index, sorted(served[(line, direction)] - set(ids))) if i is not None]
        lines[line].append({"to": head, "s": out, **({"x": extra} if extra else {})})
    OUT.write_text(json.dumps({"stops": stops, "lines": lines}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Timetable, in the same direction order as stops.json: {line: [{day: {hour: [minutes]}} per direction]}
    timetable = {}
    for line in lines:
        dirs = sorted(d for (l, d) in longest if l == line)
        timetable[line] = [{k: {str(h): sorted(m) for h, m in sorted(deps[(line, d)][k].items())} for k in DAYS} for d in dirs]
    TIMETABLE.write_text(json.dumps(timetable, separators=(",", ":")), encoding="utf-8")
    return len(lines), len(stops)
