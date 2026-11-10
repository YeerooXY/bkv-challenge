"""A fact and a few traits for every line, worked out from the stop list, the timetable and OpenStreetMap
places. Nothing is invented: every sentence comes from the data, except the short hand-written notes in
OVERRIDES, which are checked against the stops they name.

Choice: each line gets its most distinctive fact. Top-3 highest and lowest values come first; otherwise the
best of many candidates, with a penalty for kinds of fact that other lines already use, so they do not repeat.
"""
import math
from collections import Counter

from rarity import ALIAS_GROUPS

CENTER = (47.4979, 19.0402)  # Deak Ferenc ter
LONG_STOPS = 70
LANDMARKS = [  # stop-name keyword -> how it reads in the fact
    ("Állatkert", "the Zoo"), ("Vidámpark", "the Amusement Park"), ("Széchenyi fürdő", "Széchenyi Bath"), ("Gellért fürdő", "Gellért Bath"),
    ("Hősök tere", "Heroes' Square"), ("Operaház", "the Opera House"), ("Országház", "the Parliament"), ("Margit híd", "Margit Bridge"),
    ("Petőfi híd", "Petőfi Bridge"), ("Szabadság híd", "Liberty Bridge"), ("Erzsébet híd", "Elisabeth Bridge"), ("Lánchíd", "the Chain Bridge"),
    ("Szent Gellért tér", "Szent Gellért tér"), ("Normafa", "Normafa"), ("Hűvösvölgy", "Hűvösvölgy"), ("Repülőtér", "the airport"),
    ("Stadion", "a stadium"), ("Nyugati pályaudvar", "Nyugati station"), ("Keleti pályaudvar", "Keleti station"), ("Déli pályaudvar", "Déli station"),
    ("Mátyás-templom", "Matthias Church"), ("Halászbástya", "the Fisherman's Bastion"), ("Gellérthegy", "Gellért Hill"), ("Margitsziget", "Margaret Island"),
    ("Hajógyári-sziget", "Óbuda Island"), ("Csepel", "Csepel"), ("Szentendre", "Szentendre"), ("Gödöllő", "Gödöllő"), ("Kerepesi temető", "Kerepesi Cemetery"),
    ("kórház", "a hospital"), ("Egyetem", "a university"), ("temető", "a cemetery"), ("Vásárcsarnok", "a market hall"), ("piac", "a market"),
    ("uszoda", "a swimming pool"), ("strand", "an open-air pool"), ("Árkád", "the Árkád mall"), ("Allee", "the Allee mall"), ("WestEnd", "the WestEnd mall"),
    ("Mammut", "the Mammut mall"), ("Campona", "the Campona mall"), ("Auchan", "an Auchan hypermarket"), ("Aréna", "the Arena"), ("Hajóállomás", "a boat landing"),
    ("kikötő", "a harbour"), ("Millenáris", "Millenáris"), ("Gyermekvasút", "the Children's Railway"), ("Városliget", "the City Park"), ("Népliget", "Népliget"),
    ("Népstadion", "the national stadium"), ("Budapest Park", "Budapest Park"), ("Gyógyfürdő", "a thermal bath"), ("Kálvin tér", "Kálvin tér"), ("Blaha Lujza", "Blaha Lujza tér"),
    ("Moszkva tér", "Széll Kálmán tér"), ("Mexikói út", "Mexikói út"), ("Fogaskerekű", "the cog railway"), ("Libegő", "the chairlift"),
]
OVERRIDES = {  # line -> (fact, [stop names that must be on the line to use it])
    "M1": ("Opened in 1896: the oldest underground railway in continental Europe.", ["Vörösmarty tér"]),
    "M2": ("Opened in 1970. Between Batthyány tér and Kossuth Lajos tér it runs under the Danube.", ["Batthyány tér", "Kossuth Lajos tér"]),
    "M3": ("The longest of Budapest's metro lines, running from Újpest to Kőbánya-Kispest.", ["Újpest-központ", "Kőbánya-Kispest"]),
    "M4": ("Opened in 2014. Its trains run without a driver.", ["Kelenföld vasútállomás"]),
}


def dist_km(a, b):
    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def hhmm(h, m):
    return f"{h:02d}:{m:02d}"


def metrics(lid, S, timetable, svc, place_of):
    dirs = S["lines"][lid]
    main = max(dirs, key=lambda d: len(d["s"]))
    names = [S["stops"][i][0] for i in main["s"]]
    pts = [(S["stops"][i][1], S["stops"][i][2]) for i in main["s"]]
    length = sum(dist_km(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    straight = dist_km(pts[0], pts[-1])
    ends = [S["stops"][d["s"][i]] for d in dirs for i in (0, -1)]
    far = max(ends, key=lambda e: dist_km(CENTER, (e[1], e[2])))
    reach = dist_km(CENTER, (far[1], far[2]))
    group = next((g for g in ALIAS_GROUPS if lid in g), (lid,))  # tram 4 and 6 run all day as 4-6
    wd, sa, su = (sum(sum(svc.get(g, {}).get(day, [0] * 24)) for g in group) for day in ("wd", "sa", "su"))
    firsts, lasts, peak = [], [], 0
    for d in timetable.get(lid, []):
        hours = d.get("wd", {})
        if hours:
            order = sorted((int(h) for h in hours), key=lambda h: (h < 4, h))
            firsts.append((order[0], min(hours[str(order[0])])))
            lasts.append((order[-1], max(hours[str(order[-1])])))
            peak = max(peak, max(len(v) for v in hours.values()))
    return {
        "ns": len(names), "km": round(length, 1), "trips": wd, "sa": sa, "su": su, "reach": round(reach, 1),
        "space": round(length * 1000 / max(1, len(names) - 1)), "wind": round(length / straight, 2) if straight > 0.3 else 0,
        "first": min(firsts, key=lambda t: (t[0] < 4, t)) if firsts else None, "last": max(lasts, key=lambda t: (t[0] >= 4, t)) if lasts else None,
        "peak": peak, "names": names, "set": set(names), "from": names[0], "to": names[-1],
        "circular": len(dirs) == 1 and names[0] == names[-1], "one_way": len(dirs) == 1,
        "far_place": place_of(far[1], far[2]) if place_of else "",
        "places": sorted({p for p in (place_of(e[1], e[2]) for e in ends) if p}) if place_of else [],
    }


def build(S, timetable, svc, types, place_of=None, notes=None):
    """Returns {line: {"fc": fact, "tr": [traits], "ns": stops, "km": km, "tp": weekday trips}}."""
    M = {lid: metrics(lid, S, timetable, svc, place_of) for lid in S["lines"]}
    groups = {}
    for lid in M:
        groups.setdefault(types.get(lid, "BUS"), []).append(lid)
    gname = {"BUS": "bus lines", "TRAM": "tram lines", "TROLLEYBUS": "trolleybus lines", "HEV": "HEV lines", "SUBWAY": "metro lines", "FERRY": "ferry lines", "OTHER": "special lines"}

    def rank(lid, key, high=True):
        g = groups[types.get(lid, "BUS")]
        vals = sorted((M[x][key] for x in g if M[x][key]), reverse=high)
        v = M[lid][key]
        return (vals.index(v) + 1 if v in vals else 99), len(vals)

    landmark_hits = {lid: [(k, label, next(n for n in m["names"] if k.lower() in n.lower())) for k, label in LANDMARKS if any(k.lower() in n.lower() for n in m["names"])] for lid, m in M.items()}
    lm_count = Counter(k for hits in landmark_hits.values() for k, _, _ in hits)
    cands = {lid: [] for lid in M}
    for lid, m in M.items():
        t = types.get(lid, "BUS"); gn = gname.get(t, "lines"); c = cands[lid]
        for key, hi, lo in (
            ("ns", "{v} stops one way, the {r} longest stop list among the {gn}.", "Just {v} stops: the {r} shortest stop list among the {gn}."),
            ("km", "About {v} km from end to end, the {r} longest of the {gn}.", "Only about {v} km long, the {r} shortest of the {gn}."),
            ("trips", "{v} trips on a weekday, the {r} busiest of the {gn}.", "Only {v} trips on a weekday, the {r} quietest of the {gn}."),
            ("reach", "Reaches {v} km from Deák tér, the {r} farthest of the {gn}.", None),
            ("space", "A stop roughly every {v} m: the {r} widest spacing of the {gn}.", "A stop roughly every {v} m: the {r} closest spacing of the {gn}."),
            ("wind", "The route is {v} times longer than the straight line between its ends, the {r} most winding of the {gn}.", None),
        ):
            r, n = rank(lid, key, True)
            if n >= 6 and r <= 3 and m[key]:
                c.append(("rank", 100 - 3 * r, hi.format(v=m[key], r=ordinal(r), gn=gn), True))
            r2, n2 = rank(lid, key, False)
            if lo and n2 >= 6 and r2 <= 3 and m[key]:
                c.append(("rank", 100 - 3 * r2, lo.format(v=m[key], r=ordinal(r2), gn=gn), True))
        # sister lines: E (express) and A/B (variants) of a base line
        base = lid[:-1] if lid and lid[-1] in "EAB" and lid[:-1] in M else None
        if base:
            shared = len(m["set"] & M[base]["set"])
            kind = "Express version" if lid.endswith("E") else "Variant"
            if lid.endswith("E") and M[base]["ns"] > m["ns"]:
                c.append(("sister", 78, f"{kind} of {base}: calls at {m['ns']} stops where {base} has {M[base]['ns']}.", False))
            else:
                c.append(("sister", 70, f"{kind} of {base}: shares {shared} of its {m['ns']} stops with it.", False))
        # connections with metro, HEV and railway stations
        hubs = []
        for n in m["names"]:
            if n.endswith((" M", " M+H", " H", " H+M")) or "vasútállomás" in n or "pályaudvar" in n:
                short = n.split(" (")[0]
                if short not in hubs:
                    hubs.append(short)
        if len(hubs) >= 4:
            c.append(("hubs", 54 + min(len(hubs), 8), f"Meets the metro, HÉV or railway at {len(hubs)} stations, among them {', '.join(hubs[:3])}.", False))
        elif 1 <= len(hubs) <= 3 and m["ns"] > 6:
            c.append(("hubs", 46, f"Links to the metro, HÉV or railway at {' and '.join(hubs)}.", False))
        end_hubs = [e for e in (m["from"], m["to"]) if e.endswith((" M", " M+H", " H", " H+M")) or "vasútállomás" in e or "pályaudvar" in e]
        if end_hubs and m["ns"] > 6:
            other = m["to"] if end_hubs[0] == m["from"] else m["from"]
            c.append(("feeder", 59, f"A feeder: it carries people between {other.split(' (')[0]} and {end_hubs[0].split(' (')[0]}, a metro, HÉV or rail stop.", False))
        garage = [e for e in (m["from"], m["to"]) if "garázs" in e.lower() or "kocsiszín" in e.lower()]
        if garage:
            c.append(("garage", 56, f"One end of the line is a garage: {garage[0].split(' (')[0]}.", False))
        # landmarks by stop name
        if landmark_hits[lid]:
            key, label, hit = min(landmark_hits[lid], key=lambda h: lm_count[h[0]])
            c.append(("landmark", 58 + (6 if lm_count[key] <= 3 else 0), f"Passes {label}: the stop is called {hit.split(' (')[0]}.", False))
        outside = [p for p in m["places"] if p and p != "Budapest"]
        if outside and t in ("BUS", "HEV"):
            c.append(("town", 63, f"Leaves the city: it serves {', '.join(outside[:2])}.", False))
        if m["wind"] >= 1.6 and m["km"] >= 6:
            c.append(("wind", 57, f"A winding route: {m['km']:.0f} km of road for ends only {round(m['km'] / m['wind'], 1)} km apart.", False))
        if m["wind"] and m["wind"] <= 1.12 and m["km"] >= 8:
            c.append(("straight", 52, f"Almost a straight line: {m['km']:.0f} km of route for ends {round(m['km'] / m['wind'], 1)} km apart.", False))
        if m["sa"] > m["trips"] > 0:
            c.append(("weekend", 66, f"Busier on Saturdays ({m['sa']} trips) than on weekdays ({m['trips']}).", False))
        if m["trips"] == 0 and (m["sa"] or m["su"]):
            c.append(("weekend", 68, "Runs at weekends only.", False))
        if m["peak"] >= 12:
            c.append(("freq", 64, f"At the weekday peak a vehicle leaves every {max(1, round(60 / m['peak']))} minutes.", False))
        if any("Repülőtér" in n or "Liszt Ferenc" in n for n in m["names"]):
            c.append(("airport", 72, "Serves the airport.", False))
        if m["circular"]:
            c.append(("circular", 65, "A circular line: it ends where it begins.", False))
        if m["first"] and m["last"] and (m["first"][0] >= 23 or m["first"][0] < 4):
            c.append(("night", 55, f"Runs only at night: first departure {hhmm(*m['first'])}, last {hhmm(*m['last'])}.", False))
        elif m["last"] and m["last"][0] < 4 and m["last"][0] >= 0 and m["first"] and m["first"][0] >= 4:
            c.append(("late", 56, f"Keeps going after midnight: the last departure is at {hhmm(*m['last'])}.", False))
        if m["first"] and 4 <= m["first"][0] < 5 and m["first"][1] < 20 and t != "SUBWAY":
            c.append(("early", 44, f"The day's first departure leaves {m['from'].split(' (')[0]} at {hhmm(*m['first'])}, before most of the city is awake.", False))
        if 0 < m["trips"] <= 12:
            c.append(("few", 50, f"Only {m['trips']} trips on a weekday: miss one and you wait for the next.", False))
        if m["trips"] > 0 and m["sa"] == 0 and m["su"] == 0:
            span = f" between {hhmm(*m['first'])} and {hhmm(*m['last'])}" if m["first"] and m["last"] else ""
            c.append(("weekdays", 45, f"Weekdays only: {m['trips']} trips{span}, then nothing on Saturday or Sunday.", False))
        mid = m["names"][len(m["names"]) // 2].split(" (")[0]
        c.append(("route", 10, f"{m['from'].split(' (')[0]} to {m['to'].split(' (')[0]} in {m['ns']} stops and about {m['km']:.0f} km, passing {mid} halfway; {m['trips']} trips on a weekday.", False))
        if lid in OVERRIDES and all(s in m["set"] for s in OVERRIDES[lid][1]):
            c.append(("hand", 200, OVERRIDES[lid][0], True))

    # Pick the best fact per line; kinds already used a lot lose points so the lines read differently.
    used = Counter()
    chosen = {}
    for lid in sorted(M, key=lambda x: -max(s for _, s, _, _ in cands[x])):
        best = max(cands[lid], key=lambda c: c[1] - (0 if c[3] else 9 * used[c[0]]))
        used[best[0]] += 1
        # Extremes (top 3 highest or lowest) and verified notes keep their fact; the rest take the hand-written note.
        chosen[lid] = best[2] if best[3] or not notes or lid not in notes else notes[lid]

    out = {}
    for lid, m in M.items():
        traits = []
        if m["ns"] > LONG_STOPS:
            traits.append(f"Very long: {m['ns']} stops")
        if m["circular"]:
            traits.append("Circular")
        elif m["one_way"]:
            traits.append("Runs in one direction only")
        if m["trips"] > 0 and m["sa"] == 0 and m["su"] == 0:
            traits.append("Weekdays only")
        if any("Repülőtér" in n or "Liszt Ferenc" in n for n in m["names"]):
            traits.append("Serves the airport")
        out[lid] = {"fc": chosen[lid], "tr": traits, "ns": m["ns"], "km": m["km"], "tp": m["trips"]}
    return out
