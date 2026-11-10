"""Vehicle models from WinMenetrend (https://online.winmenetrend.hu), a public FUTAR vehicle list.

fetch_models() returns {plate: {"m": model family, "t": vehicle type}} for BKV buses, trams,
trolleybuses and HEV units. Rail vehicles (MAV trains, locomotives) are left out.
The page is one request; update_catalog.py calls this at most once a day.
"""
import html
import re
import urllib.request

URL = "https://online.winmenetrend.hu/futar/history/vehicles"
UA = "bkv-challenge-catalog/1.0 (+https://github.com/YeerooXY/bkv-challenge; daily fetch)"

RAIL = re.compile(r"motorvonat|mozdony|vezérlőkocsi|vezerlokocsi|mobil obu|teszt|metrovagonmas|motorkocsi|fogaskerek", re.I)
HEV_UNIT = re.compile(r"^m[xi]+a?k?-p", re.I)
TRAM = re.compile(r"tátra|tatra|t5c5|caf \d|combino|tw ?6000|ganz csukl|kcsv", re.I)
TROLLEY = re.compile(r"trollino|trolibusz|\btr\.|gvm", re.I)

# First match wins: regex -> model family shown in the app.
FAMILIES = [
    (r"volvo\s*7700", "Volvo 7700"), (r"volvo\s*7900", "Volvo 7900"), (r"volvo\s*8700", "Volvo 8700"),
    (r"volvo\s*8900", "Volvo 8900"), (r"volvo\s*8500", "Volvo 8500"), (r"volvo\s*9700", "Volvo 9700"),
    (r"alfa civis", "Volvo Alfa Civis"), (r"volvo hibrid", "Volvo hybrid"), (r"^volvo( sz[óo]l[óo].*)?$", "Volvo (solo)"),
    (r"ecitaro", "Mercedes eCitaro"),
    (r"citaro c2g|citaro g\b|o530 citaro g|c2-s1-g", "Mercedes Citaro G"),
    (r"maximidi|citaro c2 k", "Mercedes Citaro K"), (r"citaro", "Mercedes Citaro"),
    (r"conecto ?2? ?g|conecto.*csukl", "Mercedes Conecto G"), (r"conecto", "Mercedes Conecto"),
    (r"intouro", "Mercedes Intouro"), (r"tourismo", "Mercedes Tourismo"),
    (r"lions city a21", "MAN Lions City A21"), (r"lions city a23", "MAN Lions City A23 G"),
    (r"lions city c18", "MAN Lions City C18"), (r"lions city 12", "MAN Lions City 12"),
    (r"econell", "Credo Econell"), (r"inovell", "Credo Inovell"),
    (r"newag300|ag318|a330|newa330", "Van Hool"),
    (r"modulo m108", "Modulo M108"), (r"modulo m168", "Modulo M168"), (r"modulo medio", "Modulo Medio"),
    (r"byd ebus b12", "BYD eBus B12"), (r"byd ebus b19", "BYD eBus B19"),
    (r"setra", "Setra"), (r"karsan", "Karsan Atak"), (r"solaris urbino", "Solaris Urbino"), (r"itk-reform", "ITK-Reform 501"),
    (r"ikarus.*nosztalgia", "Ikarus (heritage)"), (r"ikarus 1[28]7v", "Ikarus 127V/187V"),
    (r"trollino 18|trollino 12d?\b.*(csukl)", "Solaris Trollino 18"), (r"trollino 12", "Solaris Trollino 12"),
    (r"trollino", "Solaris Trollino"), (r"gvm|ikarus 4\d\d", "Ikarus/GVM trolleybus"),
    (r"t5c5", "Tatra T5C5"), (r"caf 5", "CAF 5-module"), (r"caf 9", "CAF 9-module"), (r"combino", "Siemens Combino"),
    (r"tw ?6000", "TW 6000"), (r"kcsv", "Ganz KCSV7"), (r"ganz csukl", "Ganz articulated"),
]
FAMILIES = [(re.compile(p, re.I), name) for p, name in FAMILIES]


def family(model: str) -> str:
    m = re.sub(r"\s+", " ", model).strip()
    if HEV_UNIT.match(m):
        return "HEV unit"
    for rx, name in FAMILIES:
        if rx.search(m):
            return name
    m = re.sub(r"\(.*?\)", "", m).strip()
    return m.title() if m.isupper() else m


def vehicle_type(model: str) -> str:
    if HEV_UNIT.match(model):
        return "HEV"
    if TRAM.search(model):
        return "TRAM"
    if TROLLEY.search(model):
        return "TROLLEYBUS"
    return "BUS"


def fetch_models():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    page = urllib.request.urlopen(req, timeout=90).read().decode("utf-8", "replace")
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S)]
        if len(cells) < 3 or cells[0] == "Rendszám":
            continue
        plate, model = cells[0].replace(" ", "").upper(), cells[2]
        if not model or RAIL.search(model):
            continue
        out[plate] = {"m": family(model), "t": vehicle_type(model)}
    return out


if __name__ == "__main__":
    import collections
    data = fetch_models()
    print(len(data), "vehicles")
    for name, n in collections.Counter(v["m"] for v in data.values()).most_common(60):
        print(f"{n:5d}  {name}")
