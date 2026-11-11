"use strict";
// Nearby vehicles, Board and Get off. Loaded after app.js and built on it: the Log form, the stop picker
// (pick, nearest, buildPicker, fillSelects, renderDirs, applyStops), the single GPS watch (startTrack, stopTrack, addPoint),
// the IndexedDB drafts store, and the catalog helpers (el, badge, normPlate, tierOf, rarityWhy, clearedPlates).

const SESSION_KEY = "ride-session";
const TAB = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 12);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
const hhmm = (ms) => new Date(ms).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Budapest" });
const PAGE_STOPS = 6, NEAR_M = 1000, POLL_MS = 30000; // the server caches a stop for 20 s, so one poll per 30 s costs one upstream call per stop
const SAVED = "ride-saved:"; // drafts row left by a saved session: its entry id, so a second tab updates that entry
const focusRow = (key) => ([...$("nb-list").children].find((x) => x.dataset && x.dataset.key === key) || $("nb-title")).focus();

let nbCfg = { apiBase: "", tiles: "", attribution: "", attributionUrl: "" };
const nb = { pos: null, cands: [], offset: 0, off: new Set(), arrivals: [], skew: 0, at: 0, failed: null, seq: 0, timer: null, open: null, mode: "nearby", lines: null, busy: false, last: 0 };

// ---------- config and API ----------
async function loadNbConfig() {
  const c = await loadJson("data/api.json", {});
  const base = typeof c.apiBase === "string" ? c.apiBase.replace(/\/+$/, "") : "";
  const ok = base === "" || /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(base) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);
  const tiles = typeof c.tiles === "string" && /^https:\/\/[^\s{}]+\{z\}[^\s]*\{x\}[^\s]*\{y\}[^\s]*$/.test(c.tiles) ? c.tiles : "";
  nbCfg = { apiBase: ok ? base : null, tiles, attribution: typeof c.attribution === "string" ? c.attribution : "", attributionUrl: typeof c.attributionUrl === "string" && /^https:\/\/[^\s]+$/.test(c.attributionUrl) ? c.attributionUrl : "" };
}
const nbErr = (code) => Object.assign(new Error(code), { code });
const NB_TEXT = {
  offline: "Offline. Live arrivals are unavailable.", network: "Could not reach the arrivals service.", absent: "Live arrivals are not available yet.",
  nokey: "Live arrivals are not available right now.", busy: "Too many requests. Try again in a minute.", unavailable: "The arrivals service is unavailable right now.",
  format: "The arrivals service sent an unexpected answer.", config: "Live arrivals are not configured.", stops: "Nearby vehicles are not available yet.",
};
async function api(path, params) {
  if (nbCfg.apiBase === null) throw nbErr("config");  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => (Array.isArray(v) ? v : [v]).forEach((x) => q.append(k, x)));
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
  let r;
  try { r = await fetch(`${nbCfg.apiBase}${path}?${q}`, { signal: ctl.signal, headers: { Accept: "application/json" }, cache: "no-store" }); }
  catch { throw nbErr(navigator.onLine === false ? "offline" : "network"); }
  finally { clearTimeout(timer); }
  // An HTML page (a 404 from a static host, a captive portal) is never an empty list of arrivals.
  if (!(r.headers.get("content-type") || "").includes("json")) throw nbErr(r.status === 404 || nbCfg.apiBase === "" ? "absent" : "format"); // no service address: the static host answered
  let body; try { body = await r.json(); } catch { throw nbErr("format"); }
  if (!r.ok) throw nbErr(r.status === 429 ? "busy" : body && body.reason === "no-key" ? "nokey" : "unavailable");
  if (!body || body.schemaVersion !== 1) throw nbErr("format");
  return body;
}
const strN = (v, n) => typeof v === "string" && v.length <= n;
const numN = (v) => v === null || (typeof v === "number" && Number.isFinite(v));
function validArrival(a) {
  const v = a && a.vehicle;
  return !!a && strN(a.key, 300) && strN(a.stopId, 40) && strN(a.tripId, 80) && strN(a.line, 30) && strN(a.headsign, 150) && numN(a.scheduledAtMs) && numN(a.predictedAtMs) && numN(a.delaySec)
    && (a.timing === "realtime" || a.timing === "scheduled") && (a.plate === null || strN(a.plate, 40)) && (a.serviceDate === null || strN(a.serviceDate, 8))
    && (v === null || (typeof v === "object" && numN(v.lat) && numN(v.lon) && numN(v.positionAtMs) && (v.id === null || strN(v.id, 80))));
}

// ---------- stops near the rider ----------
// Which lines and headsigns call at each stop index, from the stop data already in the app (platforms are separate stops).
function stopLines() {
  if (nb.lines) return nb.lines;
  nb.lines = new Map();
  Object.entries(stopData.lines).forEach(([line, dirs]) => dirs.forEach((d) => [...d.s, ...(d.x || [])].forEach((i) => {
    const l = nb.lines.get(i) || []; if (!l.some((x) => x.line === line && x.to === d.to)) l.push({ line, to: d.to }); nb.lines.set(i, l);
  })));
  return nb.lines;
}
function nearbyStops(pos) {
  const out = [];
  stopData.stops.forEach((s, i) => { if (!s[3]) return; const m = dist(pos, [s[1], s[2]]); if (m <= NEAR_M) out.push({ i, m, id: s[3], name: s[0] }); });
  return out.sort((a, b) => a.m - b.m);
}
const stopById = (id) => { const i = stopData.stops.findIndex((s) => s[3] === id); return i < 0 ? null : { i, name: stopData.stops[i][0], lat: stopData.stops[i][1], lon: stopData.stops[i][2] }; };
const nbSay = (t) => { if ($("nb-status").textContent !== t) $("nb-status").textContent = t; }; // an unchanged status is not announced again
const NB_PERMANENT = ["absent", "config", "nokey"]; // retrying cannot help until the deployment changes
const nbFail = (code) => `${NB_TEXT[code] || NB_TEXT.unavailable} Use the Log form to log by hand.`;

// One locate + request at a time. `auto` (entering Log, the 30 s timer) keeps the rider's stop choices while the nearby stops are unchanged.
async function nbFind(auto) {
  if (nb.busy) return;
  nb.busy = true; nb.last = Date.now();
  try {
    if (!auto || !nb.pos) nbSay("Finding you...");
    try { nb.pos = await locate(); } catch { return nbSay(navigator.geolocation ? "Could not get your location. Allow location access and press Refresh, or use the Log form." : "This device cannot share its location. Use the Log form."); }
    if (!stopData.stops.some((s) => s[3])) return nbSay(nbFail("stops"));
    const cands = nearbyStops(nb.pos), same = cands.length === nb.cands.length && cands.every((c, i) => c.id === nb.cands[i].id);
    nb.cands = cands;
    if (!same) { nb.offset = 0; nb.off = new Set(); }
    if (!cands.length) { nb.arrivals = []; nbRows(); nbStopChips(); nbPoll(); return nbSay("No stops with vehicle data within 1 km of you. Use the Log form."); }
    await nbLoad(!same); nbPoll();
  } finally {
    nb.busy = false;
    if (nb.mode !== "nearby" || $("view-log").hidden || document.visibilityState !== "visible") nb.last = 0; // the rider left while this ran: refresh on return
  }
}
// Starts a lookup when the Nearby list is on screen and no ride is recording; `force` skips the freshness check (timer, Refresh).
function nbAuto(force) {
  if (nb.mode !== "nearby" || $("view-log").hidden || document.visibilityState !== "visible" || sessionRecording() || editing || nb.busy || nb.paused) return;
  if (force || !nb.last || Date.now() - nb.last >= POLL_MS - 1000) nbFind(true);
}
function nbPage() { return nb.cands.slice(nb.offset, nb.offset + PAGE_STOPS); }
function nbStopChips() {
  const box = $("nb-stops"), page = nbPage(), idx = box.contains(document.activeElement) ? [...box.children].indexOf(document.activeElement) : -1;
  $("nb-filter").hidden = !page.length;
  $("nb-stops-sum").textContent = `Stops, ${page.filter((c) => !nb.off.has(c.id)).length} of ${page.length} selected`;
  box.replaceChildren(...page.map((c) => {
    const heads = [...new Set((stopLines().get(c.i) || []).map((x) => x.to))].slice(0, 3);
    const b = el("button", "", `${c.name}, ${Math.round(c.m)} m${heads.length ? ", toward " + heads.join(" / ") : ""}`); b.type = "button"; b.setAttribute("aria-pressed", String(!nb.off.has(c.id)));
    b.onclick = () => { nb.off.has(c.id) ? nb.off.delete(c.id) : nb.off.add(c.id); nbStopChips(); nbRows(); };
    return b;
  }));
  if (idx >= 0) (box.children[Math.min(idx, box.children.length - 1)] || $("nb-title")).focus(); // never fall to the page body
  $("nb-more").hidden = nb.cands.length <= PAGE_STOPS;
  $("nb-more").textContent = nb.offset + PAGE_STOPS >= nb.cands.length ? "First stops" : "Next stops";
}
async function nbLoad(first) {
  const page = nbPage(), seq = ++nb.seq;
  if (!page.length) return;
  if (first) { nb.arrivals = []; nb.at = 0; nb.failed = null; nbStopChips(); nbRows(); nbSay("Loading arrivals..."); } // the cards of the previous page go with its chips
  try {
    const body = await api("/v1/arrivals", { stopId: page.map((c) => c.id) });
    if (seq !== nb.seq) return; // a newer request replaced this one
    if (!Array.isArray(body.arrivals) || !body.arrivals.every(validArrival)) throw nbErr("format");
    nb.arrivals = body.arrivals; nb.skew = Number.isFinite(body.serverNowMs) ? body.serverNowMs - Date.now() : 0; nb.at = Date.now(); nb.failed = null; nb.paused = false;
    nbSay(body.state === "partial" ? "Some stops did not load. Their vehicles are missing from this list." : nb.arrivals.length ? `${nb.arrivals.length} vehicles in the next 30 minutes.` : "No vehicles in the next 30 minutes at these stops.");
    $("nb-credit").hidden = false; $("nb-credit").textContent = `${body.attribution || "Data source: BKK Zrt., CC BY 4.0"}. Updated ${hhmm(Date.now())}.`;
  } catch (e) {
    if (seq !== nb.seq) return;
    nb.failed = e.code || "network";
    if (NB_PERMANENT.includes(nb.failed)) { nb.paused = true; clearInterval(nb.timer); nb.timer = null; } // only Refresh retries; network errors keep the 30 s retry
    nbSay(nb.arrivals.length ? `${nbFail(nb.failed)} Showing the update from ${hhmm(nb.at)}; times may have changed.` : nbFail(nb.failed));
  }
  nbRows();
}
function nbPoll() {
  if (nb.mode !== "nearby" || $("view-log").hidden || !nb.pos || nb.paused) { clearInterval(nb.timer); nb.timer = null; return; }
  // No polling during a ride (the rider is already on the vehicle); the tick re-locates, so the stops follow the rider.
  if (!nb.timer) nb.timer = setInterval(() => nbAuto(true), POLL_MS);
}

// ---------- rows ----------
function nbRow(a, now) {
  const b = el("button", "nb-row"); b.type = "button"; b.dataset.key = a.key;
  const tv = RideCore.timeView(a, hhmm), pk = a.plate ? normPlate(a.plate) : null;
  const obj = pk && allPlates().find((p) => p.plate === pk), tier = obj ? tierOf(obj) : 0;
  const lineObj = allLines().find((l) => l.id === normLine(a.line));
  const main = el("span", "nb-main"), meta = el("span", "nb-meta"), eta = el("span", "nb-eta");
  main.append(el("strong", "nb-head", a.headsign || "Destination unavailable"), meta);
  if (pk) {
    meta.append(el("span", "nb-plate", a.plate));
    meta.append(el("span", "nb-state " + (clearedPlates().has(pk) ? "done" : "new"), clearedPlates().has(pk) ? "Completed" : "New"));
    if (!clearedPlates().has(pk) && entries.some((e) => normPlate(e.plate) === pk)) meta.append(el("span", "sub", "Logged without a completed ride"));
  } else meta.append(el("span", "nb-plate none", "Plate unavailable"));
  if (tier) meta.append(el("span", `nb-tier r${tier}`, TIER_NAMES[tier]));
  const clock = el("span", "nb-time"); clock.setAttribute("aria-hidden", "true");
  if (tv.kind === "changed") clock.append(el("s", "nb-old", tv.scheduled), el("b", "nb-new", tv.predicted));
  else if (tv.kind !== "none") clock.append(el("span", tv.kind === "scheduled" ? "nb-sched" : "", tv.kind === "scheduled" ? `Scheduled ${tv.scheduled}` : tv.predicted));
  // After a failed refresh only clock times are shown: a cached minute count would be wrong.
  eta.append(el("span", "nb-min", nb.failed ? "" : RideCore.etaText(tv.effectiveMs, now)), clock, el("span", "sr", tv.label));
  const colors = lineColors(lineObj || { type: a.type }); b.style.setProperty("--line-c", "#" + colors[0]);
  b.append(badge(a.line, colors), main, eta, el("span", "sr", "Opens the map and the Board button."));
  b.onclick = () => nbOpen(a);
  return b;
}
function nbRows() {
  const box = $("nb-list"), had = box.contains(document.activeElement) ? document.activeElement : null, idx = had ? [...box.children].indexOf(had) : -1;
  const now = Date.now() + nb.skew, shown = new Set(nbPage().filter((c) => !nb.off.has(c.id)).map((c) => c.id));
  const list = RideCore.sortArrivals(nb.arrivals.filter((a) => shown.has(a.stopId) && (RideCore.timeView(a, hhmm).effectiveMs ?? now) >= now - 60000), hhmm);
  const rows = list.map((a) => nbRow(a, now));
  box.replaceChildren(...(rows.length || !nb.at || nb.failed || !nb.cands.length ? rows : [el("p", "empty", "Nothing arriving at the selected stops.")]));
  if (had) (rows.find((r) => r.dataset.key === had.dataset.key) || rows[Math.min(idx, rows.length - 1)] || $("nb-title")).focus(); // never fall to the page body
}

// ---------- map sheet ----------
function nbOpen(a) {
  nb.open = a.key;
  const stop = stopById(a.stopId), v = a.vehicle, pk = a.plate ? normPlate(a.plate) : null, tv = RideCore.timeView(a, hhmm);
  $("detail-title").textContent = `Line ${a.line} to ${a.headsign || "unknown destination"}`;
  const body = $("detail-body"); body.replaceChildren();
  const facts = el("ul", "plain");
  const late = a.delaySec, amount = late !== null && Math.abs(late) < 60 ? `${Math.abs(late)} s` : `${Math.round(Math.abs(late) / 60)} min`;
  facts.append(el("li", "", `Boarding stop: ${stop ? stop.name : a.stopId}`), el("li", "", tv.label + (a.timing === "realtime" && late ? ` (${amount} ${late > 0 ? "late" : "early"})` : "")));
  if (a.timing === "scheduled" && !a.stale) facts.append(el("li", "", "No live prediction for this vehicle. The time is the timetable."));
  if (a.stale) facts.append(el("li", "", "The last vehicle report is old, so no live prediction is shown."));
  facts.append(el("li", "", pk ? `Plate ${a.plate}. ${clearedPlates().has(pk) ? "Completed" : "New"}.` : "Plate unavailable. Check the vehicle and enter the plate on the Log form."));
  const obj = pk && allPlates().find((p) => p.plate === pk);
  if (obj && tierOf(obj) > 0) { const t = tierOf(obj); facts.append(el("li", "", `${TIER_NAMES[t]}${rarityWhy("plate", obj).length ? ": " + rarityWhy("plate", obj).join(". ") : ""}`)); }
  const pts = [];
  if (stop) pts.push({ lat: stop.lat, lon: stop.lon, kind: "stop" });
  if (v && v.lat !== null && v.lon !== null) {
    pts.push({ lat: v.lat, lon: v.lon, kind: "vehicle" });
    facts.append(el("li", "", `Vehicle position from ${v.positionAtMs ? hhmm(v.positionAtMs) : "an unknown time"}${v.stale ? ", out of date" : ""}${stop ? `, ${Math.round(dist([v.lat, v.lon], [stop.lat, stop.lon]))} m from the stop` : ""}.`));
  } else facts.append(el("li", "", "No vehicle position yet."));
  if (nb.pos) pts.push({ lat: nb.pos[0], lon: nb.pos[1], kind: "me" });
  const map = el("div", "nb-map"), board = el("button", "primary", "Board this vehicle"); board.type = "button";
  board.disabled = !!rideSession; board.onclick = () => nbBoard(a);
  const row = el("div", "row"); row.append(board);
  if (rideSession) row.append(el("span", "sub", "Finish or discard the current ride first."));
  body.append(map, facts, row, el("p", "sub", "Boarding starts the ride timer and records your location on this device until you get off."));
  $("detail").showModal();
  const text = (why) => map.replaceChildren(el("p", "sub", why));
  if (!pts.length) text("No coordinates for this stop or vehicle.");
  else if (navigator.onLine === false || !nbCfg.tiles) text(navigator.onLine === false ? "The map needs a connection. The details below are the same." : "No map provider is configured. The details below are the same.");
  else createMiniMap(map, pts, { tiles: nbCfg.tiles, attribution: nbCfg.attribution, attributionUrl: nbCfg.attributionUrl, onError: () => text("Map tiles did not load. The details below are the same.") });
}
$("detail").addEventListener("close", () => {
  const key = nb.open; nb.open = null;
  if (key) focusRow(key);
});

// ---------- Board ----------
const NB_BOARD_STATUS = (s) => `Boarded line ${s.line}${s.plate ? ", plate " + s.plate : ""} at ${hhmm(s.boardedAtMs)}.`;
async function nbBoard(a) {
  const key = nb.open; nb.open = null; $("detail").close();
  const stop = stopById(a.stopId);
  const started = await startRide({ source: "nearby", line: a.line, plate: a.plate || "", headsign: a.headsign, stop: { id: a.stopId, name: stop ? stop.name : "" },
    trip: { tripId: a.tripId, serviceDate: a.serviceDate, vehicleId: a.vehicle && a.vehicle.id, stopId: a.stopId, scheduledAtMs: a.scheduledAtMs, predictedAtMs: a.predictedAtMs } });
  if (!started) focusRow(key); // a refused Board leaves focus on the row it came from
}
// Line, plate, time, direction and boarding stop go into the existing form controls. The end stop stays open until Get off.
function applyBoarding(s, headsign, stop) {
  $("line").value = s.line; $("plate").value = s.plate; $("when").value = toLocalInput(new Date(s.boardedAtMs));
  pick.data = null; buildPicker();
  if (!pick.data) { $("stops").value = stop && stop.name ? stop.name : ""; return; }
  let hit = null;
  pick.data.forEach((d, di) => {
    const k = [...d.s, ...(d.x || [])].findIndex((i) => stopData.stops[i][3] === (stop && stop.id));
    if (k >= 0 && (!hit || String(d.to).toLowerCase() === String(headsign).toLowerCase())) hit = { di, i: d.s.findIndex((i) => stopData.stops[i][3] === stop.id) };
  });
  if (hit) {
    pick.dir = hit.di; fillSelects(); renderDirs();
    if (hit.i >= 0) { pick.from = pick.to = hit.i; pick.edited = false; $("from").value = $("to").value = String(hit.i); applyStops(); return; }
  }
  // A platform the canonical stop list lacks (short turn or branch): write the stop by hand and let the rider extend it.
  $("stops").value = stop && stop.name ? stop.name : ""; pick.edited = true; updateRideNote();
}
let starting = false;
// Stores the session only when no session row exists, so a second tab cannot overwrite a ride in progress. Resolves whether it stored.
const startRow = (s) => new Promise((res, rej) => {
  const t = db.transaction("drafts", "readwrite"), st = t.objectStore("drafts"), g = st.get(SESSION_KEY); let took = false;
  g.onsuccess = () => { if (!g.result) { st.put({ key: SESSION_KEY, session: s }); took = true; } };
  t.oncomplete = () => res(took); t.onerror = t.onabort = () => rej(t.error);
});
// Resolves true once the ride is stored. The form and track change only after that, so a refusal or a storage failure leaves the unsaved form as it was.
async function startRide(info) {
  const nearby = info.source === "nearby", say = (t) => (nb.mode === "nearby" ? nbSay(t) : rideSay(t, true)); // the idle ride bar is hidden in Nearby mode
  if (rideSession) { say("Finish or discard the current ride first."); return false; }
  if (editing) { say("Finish or cancel the edit in the Log form first."); return false; }
  const line = normLine(info.line || ""), plate = info.plate ? normPlate(info.plate) : "";
  if (!line) { show("log"); rideSay("Enter the line first.", true); $("line").focus(); return false; }
  if (!nearby && !plate) { rideSay("Enter the license plate first.", true); $("plate").focus(); return false; }
  // Nearby Board replaces the form; the manual Board keeps its form and photos and replaces only the track.
  const dirty = nearby ? !!($("line").value.trim() || $("plate").value.trim() || $("notes").value.trim() || photos.length || trackPts.length) : trackPts.length > 0;
  if (dirty && !confirm(nearby ? "The Log form holds an unsaved ride. Boarding replaces its line, plate, notes, photos and GPS track. Replace it?" : "Replace the GPS track already in the form with this ride's track?")) return false;
  const trip = info.trip || (info.stop && info.stop.id ? { tripId: null, serviceDate: null, vehicleId: null, stopId: info.stop.id, scheduledAtMs: null, predictedAtMs: null } : null); // a manual ride keeps its stop so it can be matched later
  const s = { v: 1, id: uuid(), source: info.source, line, plate, boardedAtMs: Date.now(), endedAtMs: null, trip, stopName: info.stop && info.stop.name || "", track: [], tab: TAB, toTouched: false };
  if (starting) return false; // a double tap must not start two sessions
  starting = true;
  try { if (!(await startRow(s))) { say("Another tab already has a ride in progress. Reload this page to see it."); return false; } }
  catch { say("Could not start the ride: this device cannot save it (storage blocked or full)."); return false; }
  finally { starting = false; }
  if (nearby && dirty) resetForm(); // accepted: nothing of the earlier ride carries over to this vehicle
  trackPts = [];
  if (nearby) applyBoarding(s, info.headsign, info.stop);
  else {
    $("when").value = toLocalInput(new Date(s.boardedAtMs));
    if (pick.data) { pick.to = pick.from; pick.edited = false; $("to").value = String(pick.to); applyStops(); }
  }
  rideSession = s; claimTab(); startTrack(); saveDraft();
  nbSetMode("form"); renderRideBar();
  rideSay(NB_BOARD_STATUS(s) + (plate ? "" : " Enter the plate on the form."));
  $("ride-title").focus();
  return true;
}
$("ride-board").onclick = () => {
  if (rideSession && !ownsTab()) { claimTab(); startTrack(); return renderRideBar(); } // take over a ride recorded in another tab
  const idx = pick.data ? pick.data[pick.dir].s[pick.from] : null;
  startRide({ source: "manual", line: $("line").value, plate: $("plate").value, stop: idx === null ? null : { id: stopData.stops[idx][3] || null, name: stopName(idx) } });
};

// ---------- session storage and ownership ----------
let rideStoreFailed = false;
// Writes this tab's session over the stored one only when the stored row is still this session. A ride saved or discarded in
// another tab is never brought back; a taken-over ride keeps the GPS points and the end time the other tab stored.
// Resolves false when the session is gone (this tab then drops it), true otherwise.
async function saveSession() {
  const s = rideSession;
  if (!s || s.saved) return true;
  s.track = trackPts.slice();
  try {
    const kept = await new Promise((res, rej) => {
      const t = db.transaction("drafts", "readwrite"), st = t.objectStore("drafts"), g = st.get(SESSION_KEY); let ok = false;
      g.onsuccess = () => {
        const cur = g.result && g.result.session;
        if (!cur || cur.id !== s.id) return;
        if (cur.endedAtMs !== null && s.endedAtMs === null) s.endedAtMs = cur.endedAtMs;
        if (cur.toTouched) s.toTouched = true;
        const seen = new Set();
        s.track = [...(Array.isArray(cur.track) ? cur.track : []), ...s.track].filter((p) => { const k = String(p); return !seen.has(k) && seen.add(k); }).sort((a, b) => a[2] - b[2]);
        st.put({ key: SESSION_KEY, session: s }); ok = true;
      };
      t.oncomplete = () => res(ok); t.onerror = t.onabort = () => rej(t.error);
    });
    if (!kept) { s.saved = true; await reload(); rideDone(); rideSay("This ride was already saved or discarded in another tab.", true); return false; }
    if (rideStoreFailed) { rideStoreFailed = false; rideSay(""); }
  } catch { rideStoreFailed = true; rideSay("Recording could not be saved. Free storage or export your rides. The timer keeps running and the ride is kept in memory.", true); }
  return true;
}
const OWNER = "bkv-ride-owner";
const ownerRec = () => { try { return JSON.parse(localStorage.getItem(OWNER)) || null; } catch { return null; } };
function claimTab() { try { localStorage.setItem(OWNER, JSON.stringify({ tab: TAB, id: rideSession.id, at: Date.now() })); } catch { /* no storage: single tab assumed */ } }
// Another tab owns the ride while its heartbeat is under 15 s old. Not a lock: it stops two tabs from both writing GPS into one session.
const ownsTab = () => { const o = ownerRec(); return !rideSession || !o || o.id !== rideSession.id || o.tab === TAB || Date.now() - o.at > 15000; };
setInterval(() => {
  if (!rideSession || rideSession.endedAtMs !== null) return;
  if (ownsTab()) claimTab(); else { stopTrack(); updateTrackUi(); renderRideBar(); }
}, 5000);

function rideDone() {
  if (rideSession) { try { const o = ownerRec(); if (o && o.tab === TAB) localStorage.removeItem(OWNER); } catch { /* ignore */ } }
  rideSession = null; rideStoreFailed = false; stopTrack(); renderRideBar();
}
const rideSay = (t, err) => { const m = $("ride-status"); m.textContent = t; m.className = "sub" + (err ? " err" : ""); };
const clockText = (ms) => { const s = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(s / 3600); return `${h ? h + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0") : Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------- ride bar, timer ----------
let clockTimer = null, announced = false;
function tickClock() {
  const s = rideSession; if (!s) return;
  const end = s.endedAtMs ?? Date.now();
  $("ride-clock").textContent = clockText(end - s.boardedAtMs);
  if (s.endedAtMs === null && !announced && RideCore.qualifies(s.boardedAtMs, Date.now())) { announced = true; rideSay("10 minutes on board. This plate counts once you get off and save the ride."); }
}
function renderRideBar() {
  const s = rideSession, rec = sessionRecording(), mine = ownsTab();
  clearInterval(clockTimer); clockTimer = null;
  $("ride-bar").hidden = !s && nb.mode === "nearby"; // idle: Board lives on each vehicle row in Nearby mode; an active ride is always shown
  $("ride-clock").hidden = !s; $("ride-board").hidden = !!s && mine; $("ride-off").hidden = !rec || !mine; $("ride-discard").hidden = !s || !mine;
  $("ride-board").textContent = s ? "Record in this tab" : "Board now";
  if (!s) { $("ride-info").textContent = "Board now starts the timer and records your location on this device. A plate completes after 10 minutes on board."; $("ride-clock").textContent = ""; return; }
  announced = RideCore.qualifies(s.boardedAtMs, s.endedAtMs ?? Date.now());
  const ended = s.endedAtMs !== null, ok = RideCore.qualifies(s.boardedAtMs, s.endedAtMs);
  $("ride-info").textContent = `Line ${s.line}${s.plate ? ", plate " + s.plate : ", plate not entered"}. Boarded ${hhmm(s.boardedAtMs)}${s.stopName ? " at " + s.stopName : ""}.` +
    (ended ? ` Got off ${hhmm(s.endedAtMs)}. ${ok ? "This ride counts for the plate once saved." : "Under 10 minutes: it saves, but does not complete the plate."}` : "") + (mine ? "" : " This ride is recording in another tab.");
  tickClock();
  if (rec) clockTimer = setInterval(tickClock, 1000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { tickClock(); if (rideSession && sessionRecording() && ownsTab()) startTrack(); } });

// ---------- Get off ----------
async function rideOff() {
  const s = rideSession;
  if (!s || s.endedAtMs !== null || !ownsTab()) return;
  stopTrack(); updateTrackUi();
  s.endedAtMs = Date.now(); // saved before anything else: this ends the timer
  if (!(await saveSession())) return;
  const note = suggestAlighting(s);
  renderRideBar(); nbSetMode("form");
  rideSay(`Got off at ${hhmm(s.endedAtMs)}. ${note}`);
  (pick.data && !$("stop-picker").hidden ? $("to") : $("stops")).focus();
}
// Suggest, never decide: the nearest later stop to the last GPS point, only if that point is recent. Edits are kept.
function suggestAlighting(s) {
  if (pick.edited || s.toTouched) return "Your stop list is kept as you set it. Check where you got off.";
  const d = pick.data && pick.data[pick.dir]; if (!d) return "Add where you got off.";
  const p = trackPts[trackPts.length - 1], later = d.s.slice(pick.from + 1).map((idx, k) => ({ i: pick.from + 1 + k, lat: stopData.stops[idx][1], lon: stopData.stops[idx][2] }));
  const hit = RideCore.suggestStop(p && { lat: p[0], lon: p[1], atMs: p[2] * 1000 }, later, dist, s.endedAtMs);
  if (!hit) return "No recent GPS point near a later stop. Choose where you got off.";
  pick.to = hit.i; $("to").value = String(hit.i); pick.edited = false; applyStops(); saveDraft();
  return `Suggested stop: ${stopName(d.s[hit.i])}, ${Math.round(hit.m)} m from your last GPS point. Check it before saving.`;
}
$("ride-off").onclick = rideOff;
$("to").addEventListener("change", () => { if (sessionRecording()) { rideSession.toTouched = true; saveSession(); } }); // stored now: a reload mid-ride must not lose the choice
$("ride-discard").onclick = async () => {
  if (!rideSession || !confirm("Discard this ride? The timer and its GPS track are deleted. The form is kept.")) return;
  try { await del("drafts", SESSION_KEY); } catch { return rideSay("Could not discard: storage is unavailable.", true); }
  rideSession.saved = true; trackPts = []; updateTrackUi(); rideDone(); saveDraft(); rideSay("Ride discarded.");
  ($("ride-bar").hidden ? $("nb-title") : $("ride-board")).focus(); // in Nearby mode the idle bar is hidden
};

// ---------- restore, mode, reconcile ----------
const validPoint = (p) => Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === "number" && Number.isFinite(x)) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
async function restoreRide() {
  await loadNbConfig();
  let s = null; try { s = ((await getOne("drafts", SESSION_KEY)) || {}).session || null; } catch { /* no session */ }
  const ok = s && typeof s === "object" && strN(s.id, 80) && strN(s.line, 40) && strN(s.plate, 40) && Number.isFinite(s.boardedAtMs) && (s.endedAtMs === null || Number.isFinite(s.endedAtMs)) && Array.isArray(s.track);
  if (ok && entries.some((e) => e.ride && e.ride.sessionId === s.id)) { await del("drafts", SESSION_KEY).catch(() => {}); s = null; } // already saved: never a second entry
  if (ok && s) {
    s.track = s.track.filter(validPoint); s.saved = false; s.trip = s.trip && typeof s.trip === "object" ? s.trip : null;
    rideSession = s; trackPts = s.track.slice(); updateTrackUi();
    if (s.endedAtMs === null) {
      if (ownsTab()) { claimTab(); startTrack(); }
      rideSay("Ride restored. The timer counted on from boarding. GPS points from while the app was closed are missing.");
    } else rideSay("Ride restored. Confirm the stop, add a photo and save.");
  }
  renderRideBar(); nbSetMode(rideSession ? "form" : "nearby");
  window.addEventListener("online", reconcileRides); reconcileRides();
}
function nbSetMode(m) {
  nb.mode = m;
  $("nearby").hidden = m !== "nearby"; $("form").hidden = m !== "form";
  document.querySelectorAll("#log-mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  renderRideBar(); nbPoll();
  if (m === "nearby") nbAuto();
}
document.querySelectorAll("#log-mode button").forEach((b) => (b.onclick = () => nbSetMode(b.dataset.mode)));
$("nb-locate").onclick = () => { nb.paused = false; nbFind(false); }; // an explicit Refresh lifts the pause
$("nb-more").onclick = async () => {
  if (nb.busy) return; // same one-request guard as the timer and Refresh
  nb.busy = true; nb.last = Date.now();
  nb.offset = nb.offset + PAGE_STOPS >= nb.cands.length ? 0 : nb.offset + PAGE_STOPS;
  try { await nbLoad(true); } finally { nb.busy = false; }
};
// Entering Log opens Nearby unless a ride or an edit needs the form; the first lookup runs here, never at app start.
function nearbyView(view) {
  if (view === "log" && (rideSession || editing) && nb.mode === "nearby") return nbSetMode("form");
  nbPoll();
  if (view === "log") nbAuto();
}
document.addEventListener("visibilitychange", () => nbAuto());

// Match saved rides to the API once it is reachable. Only the ride's record changes; completion never does.
// Only ride.api is written, onto the row as it is stored at that moment (photos, notes and track stay untouched bytes).
// The write is skipped when the row is gone, belongs to another session, or is open for editing.
function storeApi(e, next) {
  return new Promise((res) => {
    const t = db.transaction("entries", "readwrite"), st = t.objectStore("entries"), g = st.get(e.id); let wrote = false;
    g.onsuccess = () => {
      const cur = g.result, r = e.ride;
      if (!cur || !cur.ride || cur.ride.sessionId !== r.sessionId || cur.ride.boardedAtMs !== r.boardedAtMs || cur.ride.endedAtMs !== r.endedAtMs || (editing && editing.id === e.id)) return;
      st.put({ ...cur, ride: { ...cur.ride, api: next } }); wrote = true;
    };
    t.oncomplete = () => res(wrote); t.onerror = t.onabort = () => res(false);
  });
}
const DAY_MS = 86400000;
let reconciling = false;
// A ride is checked while it is under 24 h old, at most once an hour. After that it is recorded once as unconfirmed with no request.
// A nearby ride has a trip id and is matched by trip; a ride boarded by hand has only the boarding stop and is matched by plate, line, direction and time.
async function reconcileRides() {
  if (reconciling || navigator.onLine === false || nbCfg.apiBase === null) return;
  reconciling = true;
  let wrote = false;
  try {
    for (const e of entries.slice()) {
      const r = e.ride, t = r && r.trip, now = Date.now();
      if (!t || !r.sessionId || !r.boardedAtMs || !r.endedAtMs || !((t.tripId && t.serviceDate) || t.stopId) || (editing && editing.id === e.id)) continue;
      const old = now - r.endedAtMs > DAY_MS;
      if (r.api && (r.api.status !== "unconfirmed" || (r.api.checkedAtMs && (old || now - r.api.checkedAtMs < 3600000)))) continue;
      let next;
      if (old) next = { status: "unconfirmed", checkedAtMs: now, note: "Too long after the ride to check it against the API." };
      else {
        try {
          if (t.tripId && t.serviceDate) next = RideCore.judgeTrip(r, await api("/v1/trip", { tripId: t.tripId, serviceDate: t.serviceDate }), now);
          else {
            const res = await api("/v1/arrivals", { stopId: [t.stopId], at: Math.floor(r.boardedAtMs / 1000) });
            if (!Array.isArray(res.arrivals) || !res.arrivals.every(validArrival)) continue;
            next = RideCore.judgeArrivals(r, normLine(e.line), e.dir, res.arrivals.map((a) => ({ ...a, line: normLine(a.line), plate: a.plate ? normPlate(a.plate) : null })), now);
          }
        } catch { continue; }
      }
      if (await storeApi(e, next)) wrote = true;
    }
  } finally { reconciling = false; }
  if (wrote) { await reload(); if (!$("view-history").hidden) renderHistory(); }
}
