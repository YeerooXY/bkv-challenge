"""Run: python -I -m unittest discover -s tests -p "test_*.py" -v   (from the repository root)

The payloads below are synthetic and shaped after the FUTAR OpenAPI schema (arrivals-and-departures-for-stop with the vehicle
inline on each stop time, trip-details by `date`). They test normalisation and the server's guards. They are not live
samples and do not show real plate coverage.
"""
import json
import sys
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import futar  # noqa: E402
import server  # noqa: E402
from futar import ApiError, Transit  # noqa: E402

NOW = 1_800_000_000  # seconds
KEY = "SECRETKEY123"


def stop_time(trip, dep=None, pred=None, arr=None, **extra):
    return {"tripId": trip, "serviceDate": "20261111", "stopSequence": 3, "departureTime": dep, "predictedDepartureTime": pred, "arrivalTime": arr, **extra}


def vehicle(plate, seen, lat=47.5, lon=19.05, **extra):
    return {"vehicleId": "BKK_V", "licensePlate": plate, "location": {"lat": lat, "lon": lon}, "lastUpdateTime": seen, "bearing": 90, **extra}


def envelope(times, trips=None):
    trips = trips if trips is not None else {st["tripId"]: {"routeId": "R9", "tripHeadsign": f"Head {st['tripId']}", "directionId": "0"} for st in times}
    routes = {"R9": {"shortName": "9", "type": "BUS"}}
    return {"version": 5, "status": "OK", "code": 200, "data": {"entry": {"stopId": "BKK_F1", "stopTimes": times}, "references": {"trips": trips, "routes": routes}}}


def arrivals_payload():
    return envelope([
        stop_time("T1", NOW + 300, NOW + 420, vehicle=vehicle(" abc 123", NOW - 5)),  # late by two minutes, fresh vehicle with a plate
        stop_time("T2", NOW + 500),  # scheduled only, no vehicle record
        stop_time("T3", NOW - 600, None),  # already left
        stop_time("T4", None, None, arr=NOW + 200),  # ends here: no departure
        stop_time("T5", NOW + 800, NOW + 900, vehicle=vehicle("OLD111", NOW - 900)),  # vehicle report is old
        stop_time("T6", NOW + 700, NOW + 700, vehicle=vehicle("", NOW - 5)),  # on time (delay 0 is a real value), vehicle without plate
        stop_time("T7", NOW + 600, NOW + 660, predictionScheduled=True),  # the "prediction" is the timetable
        stop_time("T8", NOW + 650, pickupAllowed=False),  # alighting only
        stop_time("T9", NOW + 1000, NOW + 1050, vehicle=vehicle("FLG999", NOW - 5, stale=True)),  # the API flags the report stale
    ])


def trip_entry(trip, date, plate="ABC123"):
    stop_times = [{"stopId": "BKK_F1", "departureTime": NOW + 300, "predictedDepartureTime": NOW + 420}]
    return {"version": 5, "status": "OK", "code": 200, "data": {"entry": {"tripId": trip, "serviceDate": date, "vehicle": vehicle(plate, NOW - 5), "stopTimes": stop_times}}}


class Fake:
    """Stands in for futar.bkk.hu. Checks that only the allowlisted host and endpoints are used."""

    def __init__(self, arrivals=arrivals_payload, trip=lambda q: trip_entry(q["tripId"][0], q["date"][0])):
        self.calls, self.queries, self.arrivals, self.trip = [], [], arrivals, trip

    def __call__(self, url):
        assert url.startswith(futar.BASE), url
        parts = urllib.parse.urlsplit(url)
        q = urllib.parse.parse_qs(parts.query)
        assert q["key"] == [KEY] and q["version"] == ["5"]
        name = parts.path.rsplit("/", 1)[1]
        self.calls.append(name)
        self.queries.append(q)
        if name == "arrivals-and-departures-for-stop.json":
            return self.arrivals()
        if name == "trip-details.json":
            return self.trip(q)
        raise AssertionError(name)


def transit(fetch=None, key=KEY):
    return Transit(key, fetch or Fake(), clock=lambda: NOW)


class Normalise(unittest.TestCase):
    def setUp(self):
        self.rows = {r["tripId"]: r for r in transit().arrivals(["F1"])["arrivals"]}

    def test_past_and_terminating_trips_are_dropped(self):
        self.assertEqual(sorted(self.rows), ["T1", "T2", "T5", "T6", "T7", "T9"])  # T8 has no pickup

    def test_prediction_and_delay(self):
        r = self.rows["T1"]
        self.assertEqual((r["scheduledAtMs"], r["predictedAtMs"], r["timing"], r["delaySec"]), ((NOW + 300) * 1000, (NOW + 420) * 1000, "realtime", 120))
        self.assertEqual(r["plate"], "ABC123")  # whitespace and case normalised
        self.assertEqual(r["line"], "9")
        self.assertEqual(r["stopId"], "F1")  # the id the client asked with

    def test_scheduled_only_is_honest(self):
        r = self.rows["T2"]
        self.assertEqual((r["timing"], r["predictedAtMs"], r["delaySec"]), ("scheduled", None, None))

    def test_unknown_plate_stays_none(self):
        self.assertIsNone(self.rows["T2"]["plate"])  # no vehicle record
        self.assertIsNone(self.rows["T6"]["plate"])  # empty licensePlate

    def test_zero_delay_is_kept(self):
        self.assertEqual(self.rows["T6"]["delaySec"], 0)

    def test_stale_vehicle_removes_the_live_prediction(self):
        r = self.rows["T5"]
        self.assertEqual((r["timing"], r["predictedAtMs"], r["delaySec"], r["stale"]), ("scheduled", None, None, True))
        self.assertNotIn("cancelled", r)  # the schema has no cancellation field

    def test_stale_flag_from_the_api_is_honoured(self):
        r = self.rows["T9"]
        self.assertEqual((r["timing"], r["predictedAtMs"], r["stale"], r["plate"]), ("scheduled", None, True, "FLG999"))

    def test_scheduled_prediction_is_shown_as_scheduled(self):
        r = self.rows["T7"]
        self.assertEqual((r["timing"], r["predictedAtMs"], r["delaySec"], r["scheduledAtMs"]), ("scheduled", None, None, (NOW + 600) * 1000))

    def test_order_follows_effective_time(self):
        self.assertEqual([r["tripId"] for r in transit().arrivals(["F1"])["arrivals"]], ["T1", "T2", "T7", "T6", "T5", "T9"])

    def test_fifteen_plus_vehicles_cost_one_call_per_stop(self):
        times = [stop_time(f"V{i}", NOW + 60 * (i + 1), NOW + 60 * (i + 1), vehicle=vehicle(f"PL{i:03d}", NOW - 5)) for i in range(18)]
        f = Fake(arrivals=lambda: envelope(times))
        out = transit(f).arrivals(["F1"])
        self.assertEqual(f.calls, ["arrivals-and-departures-for-stop.json"])  # no per-trip calls
        self.assertEqual(f.queries[0]["includeVehicleFromTrip"], ["true"])
        self.assertEqual((out["state"], len(out["arrivals"]), [r["plate"] for r in out["arrivals"]][-1]), ("ok", 18, "PL017"))

    def test_malformed_rows_are_a_controlled_502(self):
        bad = [
            {"status": "OK", "data": {"entry": {"stopTimes": "no"}}},
            envelope([stop_time("T1", NOW + 60)], trips="oops"),
            envelope([stop_time("T1", NOW + 60)], trips={"T1": "oops"}),
            envelope([stop_time("T1", 1e999)]),
        ]
        for payload in bad:
            with self.assertRaises(ApiError) as c:
                transit(lambda url, p=payload: p).arrivals(["F1"])
            self.assertEqual(c.exception.status, 502)
        odd = envelope([{"tripId": ["x"], "departureTime": NOW + 60}, stop_time("T2", NOW + 60)], trips={"T2": {"routeId": "R9"}})  # an unusable row is skipped, not a 500
        self.assertEqual([r["tripId"] for r in transit(lambda url: odd).arrivals(["F1"])["arrivals"]], ["T2"])

    def test_history_window_uses_epoch_seconds(self):
        f = Fake(arrivals=lambda: envelope([stop_time("H1", NOW - 3000, None, vehicle=None)]))
        t = transit(f)
        out = t.arrivals(["F1"], at=NOW - 3000)
        self.assertEqual([r["tripId"] for r in out["arrivals"]], ["H1"])  # past rows are kept when a past time is asked for
        q = f.queries[0]
        self.assertEqual((q["time"], q["minutesBefore"], q["minutesAfter"]), ([str((NOW - 3000) - (NOW - 3000) % 60)], ["15"], ["15"]))
        for bad in (NOW - 10 * 86400, NOW + 86400, "17"):
            with self.assertRaises(ApiError):
                t.arrivals(["F1"], at=bad)

    def test_times_unknown_values(self):
        for v in (None, 0, -5, "17", True, False):
            self.assertIsNone(futar.ms(v))
        self.assertEqual(futar.ms(10), 10000)


class Errors(unittest.TestCase):
    def test_no_key_is_unavailable_and_calls_nothing(self):
        f = Fake()
        with self.assertRaises(ApiError) as c:
            transit(f, key="").arrivals(["F1"])
        self.assertEqual((c.exception.status, c.exception.reason, f.calls), (503, "no-key", []))

    def test_bad_input_is_rejected_before_any_call(self):
        f = Fake()
        t = transit(f)
        for bad in (["F1;rm"], ["../x"], [""], ["a" * 30], [1]):
            with self.assertRaises(ApiError) as c:
                t.arrivals(bad)
            self.assertEqual(c.exception.status, 400)
        with self.assertRaises(ApiError):
            t.arrivals([])
        with self.assertRaises(ApiError):
            t.arrivals([f"F{i}" for i in range(futar.MAX_STOPS + 1)])
        with self.assertRaises(ApiError):
            t.trip("T1 evil", "20261111")
        with self.assertRaises(ApiError):
            t.trip("T1", "2026-11-11")
        self.assertEqual(f.calls, [])

    def test_envelope_error_is_a_502_not_an_empty_list(self):
        t = transit(lambda url: {"status": "ERROR", "code": 500, "text": "boom"})
        with self.assertRaises(ApiError) as c:
            t.arrivals(["F1"])
        self.assertEqual(c.exception.status, 502)

    def test_upstream_outage_is_unavailable(self):
        def down(url):
            raise ApiError(503, "upstream-unreachable", 10)

        with self.assertRaises(ApiError) as c:
            transit(down).arrivals(["F1"])
        self.assertEqual((c.exception.status, c.exception.reason), (503, "upstream-unreachable"))

    def test_one_failing_stop_makes_the_answer_partial(self):
        def fetch(url):
            if "BKK_F2" in url:
                raise ApiError(503, "upstream-error")
            return arrivals_payload()

        out = transit(fetch).arrivals(["F1", "F2"])
        self.assertEqual(out["state"], "partial")
        self.assertTrue(out["arrivals"])

    def test_unreachable_upstream_and_redaction(self):
        with self.assertRaises(ApiError) as c:
            Transit(KEY)._http("http://127.0.0.1:9/x.json?key=" + KEY)
        self.assertEqual(c.exception.reason, "upstream-unreachable")
        self.assertNotIn(KEY, futar.redact(f"GET https://x/y?key={KEY}&a=1 failed with {KEY}", KEY))

    def test_only_allowlisted_endpoints(self):
        with self.assertRaises(AssertionError):
            transit()._call("stops-for-location", {})

    def test_shared_cache_makes_one_upstream_call(self):
        f = Fake()
        t = transit(f)
        t.arrivals(["F1"])
        n = len(f.calls)
        t.arrivals(["F1"])
        self.assertEqual(len(f.calls), n)

    def test_trip_record_uses_the_date_parameter(self):
        f = Fake()
        out = transit(f).trip("T1", "20261111")
        self.assertEqual(out["vehicle"]["plate"], "ABC123")
        self.assertEqual((f.queries[0]["date"], "serviceDate" in f.queries[0]), (["20261111"], False))

    def test_trip_response_for_another_date_or_trip_is_not_used(self):
        for entry in (("T1", "20261110"), ("T2", "20261111")):
            out = transit(Fake(trip=lambda q, e=entry: trip_entry(*e))).trip("T1", "20261111")
            self.assertEqual((out["vehicle"], out["stopTimes"]), (None, []))


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.make_server("127.0.0.1", 0, transit(), origins=["https://app.example"])
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def get(self, path, headers=None):
        try:
            r = urllib.request.urlopen(urllib.request.Request(self.base + path, headers=headers or {}), timeout=10)
            return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def test_arrivals_json_never_contains_the_key(self):
        status, headers, body = self.get("/v1/arrivals?stopId=F1", {"Origin": "https://app.example"})
        self.assertEqual(status, 200)
        self.assertIn("json", headers["Content-Type"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://app.example")
        self.assertNotIn(KEY.encode(), body)
        self.assertEqual(json.loads(body)["arrivals"][0]["plate"], "ABC123")

    def test_other_origins_get_no_cors_header(self):
        _, headers, _ = self.get("/v1/arrivals?stopId=F1", {"Origin": "https://evil.example"})
        self.assertIsNone(headers["Access-Control-Allow-Origin"])

    def test_bad_stop_is_400_json(self):
        status, headers, body = self.get("/v1/arrivals?stopId=F1%3Brm")
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["reason"], "bad-stop-id")

    def test_bad_time_is_400_json(self):
        for at in ("abc", "-5", "1" * 20):
            status, _, body = self.get(f"/v1/arrivals?stopId=F1&at={at}")
            self.assertEqual((status, json.loads(body)["reason"]), (400, "bad-time"))

    def test_static_files_are_allowlisted(self):
        self.assertEqual(self.get("/index.html")[0], 200)
        self.assertEqual(self.get("/js/app.js")[2][:12], b'"use strict"')
        for p in ("/backend/server.py", "/.git/config", "/%2e%2e/README.md", "/js/../backend/server.py", "/tests/test_futar.py", "/package.json", "/js/%5c..%5cbackend%5cserver.py"):
            self.assertEqual(self.get(p)[0], 404, p)

    def test_health_reports_live_without_the_key(self):
        _, _, body = self.get("/v1/health")
        self.assertEqual(json.loads(body), {"schemaVersion": 1, "live": True})
        self.assertNotIn(KEY.encode(), body)

    def test_rate_limit(self):
        app = server.Handler.app
        app.hits.clear()
        codes = [self.get("/v1/health")[0] for _ in range(server.CLIENT_LIMIT + 2)]
        self.assertEqual(codes[:server.CLIENT_LIMIT], [200] * server.CLIENT_LIMIT)
        self.assertEqual(codes[-1], 429)
        app.hits.clear()


class NoKeyServer(unittest.TestCase):
    def test_app_is_served_and_live_is_unavailable(self):
        srv = server.make_server("127.0.0.1", 0, Transit(""))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        try:
            self.assertEqual(urllib.request.urlopen(base + "/index.html", timeout=10).status, 200)
            with self.assertRaises(urllib.error.HTTPError) as c:
                urllib.request.urlopen(base + "/v1/arrivals?stopId=F1", timeout=10)
            self.assertEqual(c.exception.code, 503)
            self.assertEqual(json.loads(c.exception.read())["reason"], "no-key")
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
