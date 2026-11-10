"""Vehicle models from WinMenetrend (https://online.winmenetrend.hu), a public FUTAR vehicle list.

fetch_models() returns {plate: {"m": model, "t": vehicle type, "ll": last login date}} for BKV buses,
trams, trolleybuses and HEV units. Left out: rail vehicles (MAV trains, locomotives) and Volan buses.
The page is one request; update_catalog.py calls this at most once a day.
"""
import html
import re
import urllib.request

URL = "https://online.winmenetrend.hu/futar/history/vehicles"
UA = "bkv-challenge-catalog/1.0 (+https://github.com/YeerooXY/bkv-challenge; daily fetch)"

RAIL = re.compile(r"motorvonat|mozdony|vezérlőkocsi|vezerlokocsi|mobil obu|teszt|metrovagonmas|motorkocsi", re.I)
COG = re.compile(r"fogaskerek", re.I)  # the cog railway, line 60
VOLAN = re.compile(r"vol[áa]n", re.I)  # Volanbusz vehicles run some BKK lines but are not part of the BKV fleet
HEV_UNIT = re.compile(r"^m[xi]+a?k?-p", re.I)
TRAM = re.compile(r"tátra|tatra|t5c5|caf \d|combino|tw ?6000|ganz csukl|kcsv", re.I)
TROLLEY = re.compile(r"trollino|trolibusz|\btr\.|gvm", re.I)
SPECIAL = re.compile(r"mozg[áa]skorl", re.I)  # MOZG: the service for people with reduced mobility
HERITAGE = re.compile(r"nosztalgia", re.I)

WORDS = [
    (r"\bVanHool\b", "Van Hool"), (r"\bhibrid\b", "hybrid"), (r"\bSkoda\b", "Škoda"),
    (r"(CAF \d) modulos szerelv[ée]ny", r"\1-module"), (r"KCSV7 Korszer[űu]s[íi]tett Ganz", "Ganz KCSV7"),
    (r"\bITK-REFORM\b", "ITK-Reform"), (r"\bMB515\b", "MB515 minibus"),
    (r"\(.*?\)", ""), (r"\bMercedes-Benz\b|\bMERCEDES\b|\bMB\b(?=\s+(?:Citaro|Conecto))", "Mercedes"),
    (r"\bsz[óo]l[óo]\b", "solo"), (r"\bcsukl[óo]s\b|\bcsukl\.", "articulated"),
    (r"\bt[íi]pus[úu]\b|\baut[óo]busz\b|\bbusz\b|\bminibusz\b", ""), (r"\btrolibusz\b|\btr\.", "trolleybus"),
    (r"\boktat[óo]\b", "training"), (r"\bnosztalgia\b", "heritage"),
    (r"\b\d\.\s*gen\.\s*", ""), (r"-es\b", ""), (r"\s+", " "),
]


def family(model: str) -> str:
    """A specific, readable model name: variants stay separate, operator and lease notes go."""
    m = model.strip()
    if HEV_UNIT.match(m):
        return "HEV unit"
    if COG.search(m):
        return "Cog railway car"
    if SPECIAL.search(m):
        return "Accessible van (Renault Master)"
    for rx, rep in WORDS:
        m = re.sub(rx, rep, m, flags=re.I)
    m = m.strip(" -,")
    words = [w.title() if (w.isupper() and len(w) > 3 and not re.search(r"\d", w)) else w for w in m.split(" ")]
    return re.sub(r"\s{2,}", " ", " ".join(words)).strip() or model.strip()


def vehicle_type(model: str) -> str:
    if SPECIAL.search(model):
        return "OTHER"
    if HEV_UNIT.match(model):
        return "HEV"
    if TRAM.search(model) or COG.search(model):
        return "TRAM"
    if TROLLEY.search(model):
        return "TROLLEYBUS"
    return "BUS"


OLD_URL = URL + "?show_old=1"
OLD_DAYS = 365  # vehicles that have not signed on for up to a year still count: spares and stored buses


def _rows(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    page = urllib.request.urlopen(req, timeout=180).read().decode("utf-8", "replace")
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S)]
        if len(cells) >= 3 and cells[0] != "Rendszám":
            yield cells[0].replace(" ", "").upper(), cells[1], cells[2]


def _entry(last, model):
    return {"m": family(model), "t": vehicle_type(model), "ll": last[:10], "h": bool(HERITAGE.search(model))}


def fetch_models(today=None):
    from datetime import date
    today = today or date.today()
    out = {}
    for plate, last, model in _rows(URL):
        if not model or (RAIL.search(model) and not COG.search(model)) or VOLAN.search(model):
            continue
        out[plate] = _entry(last, model)
    # The "old vehicles" list: keep recent ones, never train formations (HEV ids come and go).
    try:
        for plate, last, model in _rows(OLD_URL):
            if plate in out or not model or (RAIL.search(model) and not COG.search(model)) or VOLAN.search(model) or re.match(r"^m[xi]", model, re.I):
                continue
            try:
                if (today - date.fromisoformat(last[:10])).days > OLD_DAYS:
                    continue
            except ValueError:
                continue
            out[plate] = _entry(last, model)
    except Exception as e:  # the old list is a bonus; keep going without it
        print("models: old list failed:", e)
    return out


if __name__ == "__main__":
    import collections
    data = fetch_models()
    print(len(data), "vehicles")
    for name, n in sorted(collections.Counter(v["m"] for v in data.values()).items(), key=lambda x: -x[1]):
        print(f"{n:5d}  {name}")
