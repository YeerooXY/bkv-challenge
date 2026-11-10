"""Build data/catalog.json (lines + plates) from a bkv-tracker sightings.json."""
import json
import sys
from pathlib import Path

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parents[2] / "bkv-tracker" / "sightings.json"
OUT = Path(__file__).parents[1] / "data" / "catalog.json"


def route_id_to_public(route_id: str) -> str:
    """Copied from bkv-tracker/tracker.py (approximate public line number)."""
    rid = (route_id or "").strip()
    if not rid:
        return ""
    if not rid.isdigit():
        return rid
    num = int(rid)
    public, suffix = num // 10, num % 10
    if suffix == 0:
        return str(public)
    if suffix == 5:
        return f"{public}E"
    if suffix == 1:
        return f"{public}A"
    if suffix == 2:
        return f"{public}B"
    return str(public) + chr(64 + suffix)


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    lines, plates = {}, {}
    for s in data.values():
        t = s.get("type", "UNKNOWN")
        pubs = sorted({route_id_to_public(r) for r in s.get("routes_seen_on", []) if r})
        for p in pubs:
            if p not in lines or lines[p] == "UNKNOWN":
                lines[p] = t
        plate = (s.get("license_plate") or "").replace(" ", "").upper()
        if plate:
            plates[plate] = {"plate": plate, "type": t, "lines": pubs}
    out = {
        "lines": [{"id": k, "label": k, "type": v} for k, v in sorted(lines.items())],
        "plates": sorted(plates.values(), key=lambda p: p["plate"]),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(len(out["lines"]), "lines,", len(out["plates"]), "plates ->", OUT)


main()
