"""FUTAR adapter for the nearby arrivals screen. Standard library only.

Upstream: the BKK FUTAR query API (https://opendata.bkk.hu/docs/futar-openapi.yaml), two calls only:
  arrivals-and-departures-for-stop  scheduled (departureTime) and estimated (predictedDepartureTime) times per stop,
                                    with the vehicle of every trip inline (includeVehicleFromTrip): one call per stop
  trip-details                      one trip by id and date, only to match a saved ride later

The key stays in this process. Upstream URLs are built here from a fixed host and a fixed endpoint list; clients
choose only validated stop and trip ids. Nothing here fabricates a time, a plate or a position: a missing value stays None.
"""
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

BASE = "https://futar.bkk.hu/api/query/v1/ws/otp/api/where/"
ENDPOINTS = ("arrivals-and-departures-for-stop", "trip-details")
API_VERSION = "5"  # version 5 carries predictionScheduled: a "prediction" that is only the timetable
ATTRIBUTION = "Data source: BKK Zrt., CC BY 4.0"

STOP_RE = re.compile(r"^(?:BKK_)?[A-Za-z0-9]{1,16}$")
TRIP_RE = re.compile(r"^[A-Za-z0-9_:.\-]{1,80}$")
DATE_RE = re.compile(r"^\d{8}$")
MAX_STOPS = 6  # platforms per request
MINUTES_AFTER = 30
HISTORY_WINDOW = 15  # minutes either side of a past boarding time
MAX_AGE_S = 2 * 86400  # how far back a client may ask
MAX_BODY = 2_000_000
TTL = 20  # seconds; the app polls every 30 s, so one upstream call per stop serves every client in between
STALE_MS = 180_000  # a vehicle report older than this is not live
UPSTREAM_PER_MIN = 90  # budget for all clients together
TYPE_OF = {"RAIL": "HEV", "SUBURBAN_RAILWAY": "HEV", "SUBWAY": "SUBWAY", "METRO": "SUBWAY"}


class ApiError(Exception):
    def __init__(self, status, reason, retry_after=None):
        super().__init__(reason)
        self.status, self.reason, self.retry_after = status, reason, retry_after


def redact(text, key):
    """Remove the key from any text that might be logged or returned."""
    text = re.sub(r"(?i)(key=)[^&\s\"']+", r"\1REDACTED", str(text))
    return text.replace(key, "REDACTED") if key else text


def stop_param(s):
    if not isinstance(s, str) or not STOP_RE.match(s):
        raise ApiError(400, "bad-stop-id")
    return s if s.startswith("BKK_") else "BKK_" + s


def ms(v):
    """Epoch seconds from FUTAR to milliseconds. Absent, null, zero and non-numbers are unknown."""
    return int(v) * 1000 if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def plate_of(v):
    p = re.sub(r"\s+", "", v).upper() if isinstance(v, str) else ""
    return p or None


def _data(payload):
    if not isinstance(payload, dict) or payload.get("status") != "OK" or not isinstance(payload.get("data"), dict):
        raise ApiError(502, "upstream-bad-response")
    return payload["data"]


def vehicle_block(v, now_ms):
    """A FUTAR vehicle object (inline on a stop time, or on a trip) in the app's shape; None when absent."""
    if not isinstance(v, dict):
        return None
    loc = v.get("location") if isinstance(v.get("location"), dict) else {}
    lat, lon = loc.get("lat"), loc.get("lon")
    ok = isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and -90 <= lat <= 90 and -180 <= lon <= 180
    seen = ms(v.get("lastUpdateTime"))
    bearing = v.get("bearing", v.get("heading"))
    return {
        "id": v.get("vehicleId") or None,
        "plate": plate_of(v.get("licensePlate")),
        "lat": lat if ok else None,
        "lon": lon if ok else None,
        "bearing": bearing if isinstance(bearing, (int, float)) else None,
        "positionAtMs": seen,
        "stale": v.get("stale") is True or seen is None or now_ms - seen > STALE_MS,
    }


def vehicle_of(payload, now_ms):
    """The vehicle block of a trip-details response, or None when the trip has no vehicle."""
    entry = _data(payload).get("entry")
    return vehicle_block(entry.get("vehicle"), now_ms) if isinstance(entry, dict) else None


def _dict(v):
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise ApiError(502, "upstream-bad-response")
    return v


def stop_rows(payload, stop_id, now_ms, past=False):
    """Arrival rows for one stop with the inline vehicle. Past departures (unless asked for) and stops with no pickup are dropped.
    Unexpected shapes raise ApiError 502; an absent value stays None."""
    data = _data(payload)
    entry = _dict(data.get("entry"))
    refs = _dict(data.get("references"))
    trips, routes = _dict(refs.get("trips")), _dict(refs.get("routes"))
    times = entry.get("stopTimes")
    if times is not None and not isinstance(times, list):
        raise ApiError(502, "upstream-bad-response")
    out = []
    for st in times or []:
        if not isinstance(st, dict) or not isinstance(st.get("tripId"), str) or not st["tripId"]:
            continue
        if st.get("pickupAllowed") is False:
            continue  # alighting only
        if st.get("departureTime") is None and st.get("predictedDepartureTime") is None:
            continue  # no departure from this stop: the trip ends here
        trip = _dict(trips.get(st["tripId"]))
        route = _dict(routes.get(trip.get("routeId")) if isinstance(trip.get("routeId"), str) else None)
        scheduled = ms(st.get("departureTime")) or ms(st.get("arrivalTime"))
        predicted = ms(st.get("predictedDepartureTime")) or ms(st.get("predictedArrivalTime"))
        if st.get("predictionScheduled") is True:  # the "prediction" is the timetable itself
            scheduled, predicted = scheduled or predicted, None
        effective = predicted or scheduled
        if not past and effective is not None and effective < now_ms - 60_000:
            continue
        rtype = str(route.get("type") or "").upper()
        date = st.get("serviceDate") or trip.get("serviceDate")
        out.append({
            "key": "|".join(str(x) for x in (stop_id, st["tripId"], date, st.get("stopSequence"))),
            "stopId": stop_id,
            "tripId": st["tripId"],
            "serviceDate": date if DATE_RE.match(str(date)) else None,
            "line": str(route.get("shortName") or route.get("longName") or "").strip(),
            "type": TYPE_OF.get(rtype, rtype or "OTHER"),
            "headsign": str(st.get("stopHeadsign") or trip.get("tripHeadsign") or "").strip(),
            "directionId": trip.get("directionId"),
            "scheduledAtMs": scheduled,
            "predictedAtMs": predicted,
            "timing": "realtime" if predicted else "scheduled",
            "delaySec": (predicted - scheduled) // 1000 if predicted and scheduled else None,
            "vehicle": None,
            "plate": None,
        })
        attach(out[-1], vehicle_block(st.get("vehicle"), now_ms))
    return out


def attach(row, vehicle):
    """Join a vehicle to a row. A stale report removes the live prediction instead of keeping a guess."""
    row["vehicle"] = vehicle
    if vehicle:
        row["plate"] = vehicle["plate"]
        if vehicle["stale"]:
            row["stale"] = True
            if row["timing"] == "realtime":
                row["timing"], row["predictedAtMs"], row["delaySec"] = "scheduled", None, None


def order(rows):
    key = lambda r: (r["predictedAtMs"] or r["scheduledAtMs"] or float("inf"), r["line"], r["headsign"], r["key"])
    return sorted(rows, key=key)


class Transit:
    def __init__(self, key, fetch=None, clock=time.time):
        self.key, self.clock = key or "", clock
        self.fetch = fetch or self._http
        self.cache, self.spent = {}, []
        self.lock = threading.Lock()
        self.key_locks = defaultdict(threading.Lock)
        self.pool = ThreadPoolExecutor(4)

    # ----- upstream -----
    def _http(self, url):
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "bkv-challenge-adapter"})
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                body = r.read(MAX_BODY + 1)
        except urllib.error.HTTPError as e:
            raise ApiError(503, "upstream-key-rejected" if e.code in (401, 403) else "upstream-rate-limit" if e.code == 429 else "upstream-error", 10)
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ApiError(503, "upstream-unreachable", 10)
        if len(body) > MAX_BODY:
            raise ApiError(502, "upstream-too-large")
        try:
            return json.loads(body)
        except ValueError:
            raise ApiError(502, "upstream-bad-response")

    def _spend(self):
        now = self.clock()
        with self.lock:
            self.spent = [t for t in self.spent if now - t < 60]
            if len(self.spent) >= UPSTREAM_PER_MIN:
                raise ApiError(503, "upstream-budget", 10)
            self.spent.append(now)

    def _call(self, endpoint, params):
        assert endpoint in ENDPOINTS
        self._spend()
        query = urllib.parse.urlencode({**params, "key": self.key, "version": API_VERSION, "appVersion": "bkv-challenge"})
        return self.fetch(f"{BASE}{endpoint}.json?{query}")

    def _cached(self, ck, load):
        """One upstream call per key per TTL, shared by all clients; concurrent requests wait for it."""
        hit = self.cache.get(ck)
        if hit and hit[0] > self.clock():
            return hit[1]
        with self.key_locks[ck]:
            hit = self.cache.get(ck)
            if hit and hit[0] > self.clock():
                return hit[1]
            value = load()  # errors are not cached
            with self.lock:
                now = self.clock()
                if len(self.cache) > 400:
                    self.cache = {k: v for k, v in self.cache.items() if v[0] > now}
                    self.key_locks = defaultdict(threading.Lock)
                self.cache[ck] = (now + TTL, value)
            return value

    def _need_key(self):
        if not self.key:
            raise ApiError(503, "no-key")

    # ----- public -----
    def arrivals(self, stop_ids, at=None):
        """One call per stop. `at` (epoch seconds) asks for the window around a past boarding instead of the next 30 minutes."""
        self._need_key()
        stops = list(dict.fromkeys(stop_ids))
        if not stops or len(stops) > MAX_STOPS:
            raise ApiError(400, "bad-stop-count")
        full = {s: stop_param(s) for s in stops}
        now_s = int(self.clock())
        if at is not None:
            if not isinstance(at, int) or isinstance(at, bool) or not now_s - MAX_AGE_S <= at <= now_s + 3600:
                raise ApiError(400, "bad-time")
            at -= at % 60  # one cache entry per minute
        window = {"time": at, "minutesBefore": HISTORY_WINDOW, "minutesAfter": HISTORY_WINDOW} if at is not None else {"minutesBefore": 0, "minutesAfter": MINUTES_AFTER}

        def one(s):
            p = {"stopId": full[s], **window, "includeReferences": "true", "includeVehicleFromTrip": "true"}
            try:
                return self._cached(("stop", full[s], at), lambda: self._call("arrivals-and-departures-for-stop", p))
            except ApiError as e:
                return e

        raw = list(self.pool.map(one, stops))
        now_ms = int(self.clock() * 1000)
        rows, errors = [], [r for r in raw if isinstance(r, ApiError)]
        for s, payload in zip(stops, raw):
            if not isinstance(payload, ApiError):
                try:
                    rows += stop_rows(payload, s, now_ms, past=at is not None)
                except ApiError as e:
                    errors.append(e)
                except (TypeError, AttributeError, ValueError, OverflowError):  # a shape the checks above did not foresee
                    errors.append(ApiError(502, "upstream-bad-response"))
        if len(errors) == len(stops):  # every stop failed: unavailable, never an empty list
            raise errors[0]
        return {"schemaVersion": 1, "serverNowMs": now_ms, "state": "partial" if errors else "ok", "arrivals": order(rows), "attribution": ATTRIBUTION}

    def trip(self, trip_id, service_date):
        """One trip as the API holds it now, for matching a saved ride later. A response for another trip or date is not used."""
        self._need_key()
        if not TRIP_RE.match(trip_id or "") or not DATE_RE.match(service_date or ""):
            raise ApiError(400, "bad-trip")
        now_ms = int(self.clock() * 1000)
        payload = self._cached(("trip", (trip_id, service_date)), lambda: self._call("trip-details", {"tripId": trip_id, "date": service_date, "includeReferences": "false"}))
        entry = _dict(_data(payload).get("entry"))
        out = {"schemaVersion": 1, "serverNowMs": now_ms, "tripId": trip_id, "serviceDate": service_date, "vehicle": None, "stopTimes": []}
        if entry.get("tripId") != trip_id or entry.get("serviceDate") != service_date:
            return out
        try:
            out["vehicle"] = vehicle_block(entry.get("vehicle"), now_ms)
            out["stopTimes"] = [{"stopId": s.get("stopId"), "scheduledAtMs": ms(s.get("departureTime")) or ms(s.get("arrivalTime")), "predictedAtMs": None if s.get("predictionScheduled") is True else ms(s.get("predictedDepartureTime")) or ms(s.get("predictedArrivalTime"))} for s in entry.get("stopTimes") or [] if isinstance(s, dict)]
        except (TypeError, AttributeError, ValueError, OverflowError):
            raise ApiError(502, "upstream-bad-response")
        return out
