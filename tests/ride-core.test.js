// Run: node --test tests/ride-core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/ride-core.js");

const normPlate = (s) => s.replace(/\s+/g, "").toUpperCase();
const normLine = (s) => s.trim().toUpperCase();
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
const ride = (sec, plate = "ABC123") => ({ plate, boardedAtMs: 1000, endedAtMs: 1000 + sec * 1000, sessionId: "s1" });
const entry = (r, plate = "ABC123") => ({ plate, line: "9", ...(r ? { ride: r } : {}) });

test("599 seconds fails, 600 passes", () => {
  assert.equal(R.qualifies(0, 599000), false);
  assert.equal(R.qualifies(0, 599999), false);
  assert.equal(R.qualifies(0, 600000), true);
  assert.equal(R.rideSec(0, 599999), 599);
  assert.equal(R.countsForPlate(entry(ride(599)), normPlate), false);
  assert.equal(R.countsForPlate(entry(ride(600)), normPlate), true);
});

test("only two timestamps matter: GPS gaps, an empty track and outages change nothing", () => {
  const r = { ...ride(600), track: [], gpsGaps: [[100, 500]], offline: true };
  assert.equal(R.countsForPlate(entry(r), normPlate), true);
});

test("rides are never pooled", () => {
  const rides = [entry(ride(300)), entry(ride(300)), entry(ride(599))];
  assert.equal(rides.filter((e) => R.countsForPlate(e, normPlate)).length, 0);
});

test("a clock that goes backwards, or missing timing, never counts", () => {
  assert.equal(R.rideMs(5000, 1000), 0);
  assert.equal(R.qualifies(null, 1e12), false);
  assert.equal(R.countsForPlate(entry({ plate: "ABC123", boardedAtMs: null, endedAtMs: null }), normPlate), false);
});

test("legacy entries keep credit; an edited plate does not transfer it", () => {
  assert.equal(R.countsForPlate(entry(null), normPlate), true);
  assert.equal(R.countsForPlate(entry(ride(900), "XYZ999"), normPlate), false); // boarded as ABC123, saved as XYZ999
  assert.equal(R.countsForPlate(entry(ride(900), "abc 123"), normPlate), true);
});

test("saving one session twice targets one entry", () => {
  const list = [{ id: 4, ride: { sessionId: "s1" } }, { id: 5 }];
  assert.equal(R.entryIdForSession(list, "s1"), 4);
  assert.equal(R.entryIdForSession(list, "s2"), undefined);
  assert.equal(R.entryIdForSession(list, null), undefined);
});

test("time view: scheduled only, on time, changed, predicted only, none", () => {
  const S = Date.parse("2026-11-11T14:00:00Z"), P = Date.parse("2026-11-11T14:07:00Z");
  assert.deepEqual(R.timeView({ scheduledAtMs: S, predictedAtMs: null, timing: "scheduled" }, hhmm), { kind: "scheduled", scheduled: "14:00", label: "Scheduled 14:00", effectiveMs: S });
  const c = R.timeView({ scheduledAtMs: S, predictedAtMs: P, timing: "realtime" }, hhmm);
  assert.equal(c.kind, "changed"); assert.equal(c.scheduled, "14:00"); assert.equal(c.predicted, "14:07"); assert.equal(c.label, "Scheduled 14:00, predicted 14:07"); assert.equal(c.effectiveMs, P);
  assert.equal(R.timeView({ scheduledAtMs: S, predictedAtMs: S + 20000, timing: "realtime" }, hhmm).kind, "same");
  // A prediction on a row marked scheduled (stale) is ignored: nothing is invented.
  assert.equal(R.timeView({ scheduledAtMs: S, predictedAtMs: P, timing: "scheduled" }, hhmm).kind, "scheduled");
  assert.equal(R.timeView({ scheduledAtMs: null, predictedAtMs: P, timing: "realtime" }, hhmm).kind, "predicted");
  assert.equal(R.timeView({ scheduledAtMs: null, predictedAtMs: null, timing: "scheduled" }, hhmm).kind, "none");
});

test("arrivals sort by effective time, unknown last, ties stable", () => {
  const a = (key, line, s, p, plate = null) => ({ key, line, headsign: "H", scheduledAtMs: s, predictedAtMs: p, timing: p ? "realtime" : "scheduled", plate });
  const out = R.sortArrivals([a("d", "9", null, null), a("c", "10", 3000, null), a("b", "9", 3000, null), a("a", "9", 1000, 5000)], hhmm).map((x) => x.key);
  assert.deepEqual(out, ["b", "c", "a", "d"]); // 3000 (line 9, then 10), then predicted 5000, then unknown
  assert.equal(R.etaText(null, 0), ""); assert.equal(R.etaText(10000, 0), "Now"); assert.equal(R.etaText(5 * 60000, 0), "5 min");
});

test("suggested stop needs a recent fix and a close stop", () => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * 111000;
  const stops = [{ i: 3, lat: 0, lon: 0.001 }, { i: 4, lat: 0, lon: 0.01 }];
  assert.deepEqual(R.suggestStop({ lat: 0, lon: 0.0011, atMs: 1000 }, stops, dist, 5000).i, 3);
  assert.equal(R.suggestStop({ lat: 0, lon: 0.0011, atMs: 1000 }, stops, dist, 1000 + 200000), null); // fix older than 2 minutes: a GPS gap gives no guess
  assert.equal(R.suggestStop({ lat: 0, lon: 0.005, atMs: 1000 }, stops, dist, 2000), null); // too far from both
  assert.equal(R.suggestStop(undefined, stops, dist, 2000), null);
});

test("trip matching never overstates", () => {
  const r = { plate: "ABC123", boardedAtMs: 1e9, trip: { stopId: "F1" } };
  const res = (plate, t) => ({ vehicle: plate && { plate }, stopTimes: [{ stopId: "BKK_F1", scheduledAtMs: t, predictedAtMs: null }] });
  assert.equal(R.judgeTrip(r, res("ABC123", 1e9 + 60000), 7).status, "matched");
  assert.equal(R.judgeTrip(r, res("XYZ999", 1e9), 7).status, "conflict");
  assert.equal(R.judgeTrip(r, res(null, 1e9), 7).status, "unconfirmed");
  assert.equal(R.judgeTrip(r, res("ABC123", 1e9 + 3 * 3600000), 7).status, "unconfirmed");
  assert.equal(R.judgeTrip(r, null, 7).status, "unconfirmed");
  // a delayed trip: boarded near the predicted time, far from the scheduled one
  const late = { vehicle: { plate: "ABC123" }, stopTimes: [{ stopId: "F1", scheduledAtMs: 1e9 - 3600000, predictedAtMs: 1e9 + 60000 }] };
  assert.equal(R.judgeTrip(r, late, 7).status, "matched");
  // an answer for another trip or date is never a match
  const t = { plate: "ABC123", boardedAtMs: 1e9, trip: { tripId: "T1", serviceDate: "20261111", stopId: "F1" } };
  const ans = (tripId, serviceDate) => ({ tripId, serviceDate, ...res("ABC123", 1e9) });
  assert.equal(R.judgeTrip(t, ans("T1", "20261111"), 7).status, "matched");
  assert.equal(R.judgeTrip(t, ans("T1", "20261110"), 7).status, "unconfirmed");
  assert.equal(R.judgeTrip(t, ans("T2", "20261111"), 7).status, "unconfirmed");
});

test("manual rides match only the exact plate, line, direction, stop and time", () => {
  const ride = { plate: "ABC123", boardedAtMs: 1e9, trip: { tripId: null, stopId: "F1" } };
  const row = (o) => ({ stopId: "BKK_F1", line: "9", headsign: "Kelenföld", plate: "ABC123", scheduledAtMs: 1e9 + 120000, predictedAtMs: null, ...o });
  const j = (rows, dir = "kelenföld") => R.judgeArrivals(ride, "9", dir, rows, 7).status;
  assert.equal(j([row({})]), "matched");
  assert.equal(j([row({ plate: "XYZ999" })]), "unconfirmed"); // another vehicle is not a conflict
  assert.equal(j([row({ line: "10" })]), "unconfirmed");
  assert.equal(j([row({ headsign: "Other" })]), "unconfirmed");
  assert.equal(j([row({ stopId: "F2" })]), "unconfirmed");
  assert.equal(j([row({ scheduledAtMs: 1e9 + 3600000 })]), "unconfirmed");
  assert.equal(j([row({ scheduledAtMs: 1e9 - 3600000, predictedAtMs: 1e9 + 60000 })]), "matched"); // delay: predicted time counts
  assert.equal(j([]), "unconfirmed");
});

const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const good = () => ({ line: " 9 ", plate: "abc 123", time: "2026-11-11T10:00:00.000Z", stops: ["A", "B"], track: [[47.5, 19.04, 1700000000]], photos: [PHOTO], notes: "n", dir: "d" });

test("import accepts a v1 entry and leaves legacy entries without a ride record", () => {
  const input = good(), out = R.cleanEntry(input, { normLine, normPlate });
  assert.equal(out.line, "9"); assert.equal(out.plate, "ABC123"); assert.equal("ride" in out, false);
  assert.equal(input.plate, "abc 123"); // input untouched
});

test("import rejects bad coordinates, times, photo URLs and ride records", () => {
  const bad = (patch) => R.cleanEntry({ ...good(), ...patch }, { normLine, normPlate });
  assert.equal(bad({ track: [[91, 0, 1]] }), null);
  assert.equal(bad({ track: [[0, 181, 1]] }), null);
  assert.equal(bad({ track: [[0, 0, "x"]] }), null);
  assert.equal(bad({ time: "not a date" }), null);
  assert.equal(bad({ photos: ["https://example.com/a.jpg"] }), null); // no remote fetch
  assert.equal(bad({ photos: ["data:text/html;base64,PGI+"] }), null);
  assert.equal(bad({ photos: ["javascript:alert(1)"] }), null);
  assert.equal(bad({ stops: [1] }), null);
  assert.equal(bad({ ride: { plate: 5 } }), null);
  assert.equal(bad({ ride: { plate: "ABC123", boardedAtMs: "1", endedAtMs: 2 } }), null);
  assert.equal(bad({ ride: { plate: "ABC123", boardedAtMs: 1, endedAtMs: 2, api: { status: "verified" } } }), null);
  assert.equal(R.cleanEntry(null, { normLine, normPlate }), null);
  const ok = bad({ ride: { plate: "ABC123", boardedAtMs: 0, endedAtMs: 600000, sessionId: "s", source: "nearby", trip: { tripId: "T", serviceDate: "20261111", stopId: "F1", scheduledAtMs: 1 }, api: { status: "unconfirmed", checkedAtMs: null } } });
  assert.equal(R.countsForPlate({ plate: ok.plate, ride: ok.ride }, normPlate), true);
});

test("extras are validated", () => {
  assert.deepEqual(R.cleanExtra({ kind: "plate", value: "ABC123", type: "BUS" }, ["BUS", "OTHER"]), { key: "plate:ABC123", kind: "plate", value: "ABC123", type: "BUS" });
  assert.equal(R.cleanExtra({ kind: "other", value: "x" }, ["BUS"]), null);
  assert.equal(R.cleanExtra({ kind: "line", value: "" }, ["BUS"]), null);
  assert.equal(R.cleanExtra({ kind: "line", value: "9", type: "<img>" }, ["BUS", "OTHER"]).type, "OTHER");
});
