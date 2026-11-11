"use strict";
// Pure ride rules. The app reads them as the global RideCore; the Node tests require this file.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.RideCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  // The only qualification rule: one plate, one session, Board to Get off on the wall clock.
  // GPS gaps, a hidden page, traffic and network outages never change these two timestamps.
  const MIN_RIDE_MS = 600000;
  const rideMs = (boardedAtMs, endedAtMs) => (Number.isFinite(boardedAtMs) && Number.isFinite(endedAtMs) && endedAtMs > boardedAtMs ? endedAtMs - boardedAtMs : 0);
  const rideSec = (b, e) => Math.floor(rideMs(b, e) / 1000);
  const qualifies = (b, e) => rideMs(b, e) >= MIN_RIDE_MS;

  // Entries saved before ride timing existed have no `ride` and keep their credit.
  // A new entry always has `ride`; it counts only for the plate it was boarded with, and only at 600 s or more.
  function countsForPlate(entry, normPlate) {
    const r = entry.ride;
    if (!r) return true;
    return r.plate === normPlate(entry.plate) && qualifies(r.boardedAtMs, r.endedAtMs);
  }

  // Saving the same session twice must update one entry, not add a second.
  const entryIdForSession = (entries, sessionId) => {
    const e = sessionId && entries.find((x) => x.ride && x.ride.sessionId === sessionId);
    return e ? e.id : undefined;
  };

  // Nearest downstream stop to the last fix. Null when the fix is old, so a GPS gap never yields a guess.
  function suggestStop(fix, candidates, dist, nowMs, maxM = 250, maxAgeMs = 120000) {
    if (!fix || nowMs - fix.atMs > maxAgeMs) return null;
    let best = null;
    for (const c of candidates) {
      const m = dist([fix.lat, fix.lon], [c.lat, c.lon]);
      if (m <= maxM && (!best || m < best.m)) best = { i: c.i, m };
    }
    return best;
  }

  // ---------- arrival rows ----------
  // Scheduled time, and the live prediction only when it exists. Nothing is invented.
  function timeView(a, hhmm) {
    const s = Number.isFinite(a.scheduledAtMs) ? a.scheduledAtMs : null;
    const p = a.timing === "realtime" && Number.isFinite(a.predictedAtMs) ? a.predictedAtMs : null;
    if (s === null && p === null) return { kind: "none", label: "Time unavailable", effectiveMs: null };
    if (p === null) return { kind: "scheduled", scheduled: hhmm(s), label: `Scheduled ${hhmm(s)}`, effectiveMs: s };
    if (s === null) return { kind: "predicted", predicted: hhmm(p), label: `Predicted ${hhmm(p)}`, effectiveMs: p };
    if (hhmm(s) === hhmm(p)) return { kind: "same", predicted: hhmm(p), label: `On time, ${hhmm(s)}`, effectiveMs: p };
    return { kind: "changed", scheduled: hhmm(s), predicted: hhmm(p), label: `Scheduled ${hhmm(s)}, predicted ${hhmm(p)}`, effectiveMs: p };
  }
  const etaText = (effMs, nowMs) => {
    if (effMs === null) return "";
    const m = Math.round((effMs - nowMs) / 60000);
    return m < 1 ? "Now" : `${m} min`;
  };
  const byLine = (a, b) => String(a).localeCompare(String(b), "hu", { numeric: true });
  function sortArrivals(list, hhmm) {
    const t = (a) => timeView(a, hhmm).effectiveMs;
    return list.slice().sort((a, b) => {
      const x = t(a), y = t(b);
      if (x !== y) return x === null ? 1 : y === null ? -1 : x - y;
      return byLine(a.line, b.line) || byLine(a.headsign, b.headsign) || byLine(a.plate || "", b.plate || "") || byLine(a.key, b.key);
    });
  }

  // ---------- matching a saved ride with the API later ----------
  // Never changes completion. The API shows only the trip as it is now: a missing or different record
  // leaves the ride "unconfirmed", and a predicted time is not an observed departure.
  const sameStop = (a, b) => !!a && !!b && String(a).replace(/^BKK_/, "") === String(b).replace(/^BKK_/, "");
  // Boarding is "near" a stop time when it is within the window of the predicted time (a delayed trip) or the scheduled one.
  const near = (boardedAtMs, st, windowMs) => Number.isFinite(boardedAtMs) && [st.predictedAtMs, st.scheduledAtMs].some((t) => Number.isFinite(t) && Math.abs(boardedAtMs - t) <= windowMs);
  function judgeTrip(ride, res, nowMs, windowMs = 20 * 60000) {
    const api = (status, note) => ({ status, checkedAtMs: nowMs, note });
    const v = res && res.vehicle, want = ride.trip || {};
    if (res && want.tripId && (res.tripId !== want.tripId || res.serviceDate !== want.serviceDate)) return api("unconfirmed", "The API answered for another trip or date.");
    if (!v || !v.plate) return api("unconfirmed", "The API has no vehicle record for this trip now.");
    if (ride.plate && v.plate !== ride.plate) return api("conflict", `The API lists plate ${v.plate} for this trip.`);
    const st = (res.stopTimes || []).find((s) => sameStop(s.stopId, want.stopId));
    if (!st || !near(ride.boardedAtMs, st, windowMs)) return api("unconfirmed", "The API record does not cover the boarding time.");
    return api("matched", "Plate and trip match the API record. Times shown there are scheduled or predicted, not observed.");
  }
  // A ride without a trip id (boarded by hand): look for the exact plate, line and direction at the boarding stop around the boarding time.
  // `rows` are arrival rows whose line and plate the caller already normalised. A missing match stays unconfirmed, never a conflict.
  function judgeArrivals(ride, line, dir, rows, nowMs, windowMs = 20 * 60000) {
    const stop = ride.trip && ride.trip.stopId, want = String(dir || "").toLowerCase();
    const hit = (rows || []).find((a) => a.plate && a.plate === ride.plate && a.line === line && sameStop(a.stopId, stop) && (!want || String(a.headsign).toLowerCase() === want) && near(ride.boardedAtMs, a, windowMs));
    return hit ? { status: "matched", checkedAtMs: nowMs, note: "Plate, line and time match the API arrivals at the boarding stop. Times shown there are scheduled or predicted, not observed." }
      : { status: "unconfirmed", checkedAtMs: nowMs, note: "The API has no matching vehicle for this boarding." };
  }

  // ---------- import validation ----------
  const IMG = /^data:image\/(?:jpeg|png|webp|gif|heic|heif|avif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/;
  const str = (v, max) => typeof v === "string" && v.length <= max;
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const numOrNull = (v) => v === null || v === undefined || num(v);
  const nullable = (v) => (v === undefined ? null : v);

  function cleanTrip(t) {
    if (t === null || t === undefined) return null;
    if (typeof t !== "object") return undefined;
    for (const k of ["tripId", "serviceDate", "vehicleId", "stopId"]) if (t[k] !== null && t[k] !== undefined && !str(t[k], 80)) return undefined;
    if (!numOrNull(t.scheduledAtMs) || !numOrNull(t.predictedAtMs)) return undefined;
    return { tripId: nullable(t.tripId), serviceDate: nullable(t.serviceDate), vehicleId: nullable(t.vehicleId), stopId: nullable(t.stopId), scheduledAtMs: nullable(t.scheduledAtMs), predictedAtMs: nullable(t.predictedAtMs) };
  }
  function cleanRide(r) {
    if (!r || typeof r !== "object" || !str(r.plate, 40) || !numOrNull(r.boardedAtMs) || !numOrNull(r.endedAtMs)) return null;
    const trip = cleanTrip(r.trip);
    if (trip === undefined) return null;
    if (r.sessionId !== null && r.sessionId !== undefined && !str(r.sessionId, 80)) return null;
    let api = null;
    if (r.api) {
      if (typeof r.api !== "object" || !["unconfirmed", "matched", "conflict"].includes(r.api.status) || !numOrNull(r.api.checkedAtMs)) return null;
      api = { status: r.api.status, checkedAtMs: nullable(r.api.checkedAtMs), note: str(r.api.note, 200) ? r.api.note : "" };
    }
    return { sessionId: nullable(r.sessionId), plate: r.plate, boardedAtMs: nullable(r.boardedAtMs), endedAtMs: nullable(r.endedAtMs), source: r.source === "nearby" ? "nearby" : "manual", trip, api };
  }
  // Returns a clean entry (photos still data URLs) or null. Never touches the input.
  function cleanEntry(e, { normLine, normPlate }) {
    if (!e || typeof e !== "object" || !str(e.line, 40) || !str(e.plate, 40)) return null;
    const line = normLine(e.line), plate = normPlate(e.plate);
    if (!line || !plate || typeof e.time !== "string" || Number.isNaN(Date.parse(e.time))) return null;
    const stops = e.stops === undefined ? [] : e.stops, track = e.track === undefined ? [] : e.track, photos = e.photos === undefined ? [] : e.photos;
    if (!Array.isArray(stops) || stops.length > 500 || !stops.every((s) => str(s, 200))) return null;
    if (!Array.isArray(track) || track.length > 5000 || !track.every((p) => Array.isArray(p) && p.length === 3 && p.every(num) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && p[2] >= 0)) return null;
    if (!Array.isArray(photos) || photos.length > 30 || !photos.every((u) => str(u, 20e6) && IMG.test(u))) return null;
    const out = { line, plate, time: e.time, dir: str(e.dir, 200) ? e.dir : "", stops, track, notes: str(e.notes, 20000) ? e.notes : "", photos };
    if (e.ride !== undefined) { const ride = cleanRide(e.ride); if (!ride) return null; out.ride = ride; }
    return out;
  }
  function cleanExtra(x, types) {
    if (!x || typeof x !== "object" || !["line", "plate"].includes(x.kind) || !str(x.value, 40) || !x.value.trim()) return null;
    return { key: x.kind + ":" + x.value, kind: x.kind, value: x.value, type: types.includes(x.type) ? x.type : "OTHER" };
  }

  return { MIN_RIDE_MS, rideMs, rideSec, qualifies, countsForPlate, entryIdForSession, suggestStop, judgeTrip, judgeArrivals, sameStop, timeView, etaText, sortArrivals, cleanEntry, cleanExtra, IMG };
});
