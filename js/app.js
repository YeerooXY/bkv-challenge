"use strict";
// BKV Challenge: offline-first ride log. Data lives in IndexedDB on this device only.

const $ = (id) => document.getElementById(id);
const TYPES = { ALL: "All", BUS: "Bus", TRAM: "Tram", TROLLEYBUS: "Trolley", HEV: "HEV", SUBWAY: "Metro", FERRY: "Ferry", OTHER: "Other" };
// Colors follow the BKK network: blue buses, yellow trams, red trolleybuses. [background, text]
const TYPE_COLOR = {
  BUS: ["009EE3", "FFFFFF"], TRAM: ["FFD800", "000000"], TROLLEYBUS: ["E41F18", "FFFFFF"], HEV: ["2E9B4B", "FFFFFF"],
  SUBWAY: ["5B5B5B", "FFFFFF"], FERRY: ["007F8C", "FFFFFF"], OTHER: ["6B7280", "FFFFFF"],
};
const typeOf = (t) => (TYPES[t] && t !== "ALL" ? t : "OTHER");
const normLine = (s) => s.trim().toUpperCase();
const normPlate = (s) => s.replace(/\s+/g, "").toUpperCase();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const lineColors = (l) => (l && l.color ? [l.color, l.text || "FFFFFF"] : TYPE_COLOR[typeOf(l && l.type)]);
function badge(text, [bg, fg], cls = "") {
  const s = el("span", "badge " + cls, text); s.style.background = "#" + bg; s.style.color = "#" + fg; return s;
}
const lineBadge = (id) => badge(id, lineColors(allLines().find((l) => l.id === id)));

let catalog = { lines: [], plates: [] };
let stopData = { stops: [], lines: {} };
let entries = [];
let extras = [];
let editing = null; // entry being edited
let photos = []; // [{blob, url}] attached to the form
const filters = { lines: "ALL", plates: "ALL" };

// ---------- IndexedDB ----------
let db;
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("bkv-challenge", 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("entries")) d.createObjectStore("entries", { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains("extras")) d.createObjectStore("extras", { keyPath: "key" });
      if (!d.objectStoreNames.contains("drafts")) d.createObjectStore("drafts", { keyPath: "key" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = (store, mode, fn) =>
  new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
const getAll = (store) => tx(store, "readonly", (s) => s.getAll());
const getOne = (store, k) => tx(store, "readonly", (s) => s.get(k));
const put = (store, v) => tx(store, "readwrite", (s) => s.put(v));
const del = (store, k) => tx(store, "readwrite", (s) => s.delete(k));
// Photos are stored as raw bytes: Safari/WebKit can reject Blobs in IndexedDB.
const packPhoto = async (b) => ({ type: b.type || "image/jpeg", data: await b.arrayBuffer() });
const unpackPhoto = (p) => (p instanceof Blob ? p : new Blob([p.data], { type: p.type }));

async function reload() {
  entries = (await getAll("entries")).map((e) => ({ ...e, photos: e.photos.map(unpackPhoto) })).sort((a, b) => b.time.localeCompare(a.time));
  extras = await getAll("extras");
}

// ---------- catalog ----------
const allLines = () => {
  const m = new Map(catalog.lines.map((l) => [l.id, l]));
  extras.filter((e) => e.kind === "line").forEach((e) => m.set(e.value, { id: e.value, label: e.value, type: e.type || "OTHER" }));
  return [...m.values()];
};
const allPlates = () => {
  const m = new Map(catalog.plates.map((p) => [p.plate, p]));
  extras.filter((e) => e.kind === "plate").forEach((e) => m.set(e.value, { plate: e.value, type: e.type || "OTHER" }));
  return [...m.values()];
};
const clearedLines = () => new Set(entries.map((e) => normLine(e.line)));
const clearedPlates = () => new Set(entries.map((e) => normPlate(e.plate)));

// The installed Android app bundles a catalog, but the hourly updates live on the website:
// fetch the newest one when online, remember it, and fall back to the saved or bundled copy.
const LIVE_CATALOG = "https://yeerooxy.github.io/bkv-challenge/data/catalog.json";
async function loadCatalog() {
  const native = location.hostname === "localhost" && location.port === "";
  try {
    const r = await fetch(native ? LIVE_CATALOG : "data/catalog.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    try { localStorage.setItem("catalog", JSON.stringify(data)); } catch { /* storage full: skip the copy */ }
    return data;
  } catch {
    try { const saved = localStorage.getItem("catalog"); if (saved) return JSON.parse(saved); } catch { /* ignore */ }
    try { return await (await fetch("data/catalog.json")).json(); } catch { return { lines: [], plates: [] }; }
  }
}
async function loadStops() {
  try { return await (await fetch("data/stops.json")).json(); } catch { return { stops: [], lines: {} }; }
}

// ---------- smart search ----------
// Matching ignores spaces/case and treats the letter O and digit 0 as the same character.
const sKey = (t) => t.replace(/[\s-]+/g, "").toUpperCase().replace(/O/g, "0");
// Riders usually type the start or the last digits of a plate.
const rank = (k, q) => (k.startsWith(q) ? 0 : k.endsWith(q) ? 1 : 2);

function attachSuggest(input, list, getMatches, onPick) {
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  const mark = () => items.forEach((it, i) => it.el.setAttribute("aria-selected", String(i === active)));
  function render() {
    const raw = input.value.trim();
    if (!raw) return close();
    items = getMatches(raw).map((m, i) => {
      const li = el("li"); li.id = `${list.id}-${i}`; li.setAttribute("role", "option");
      const main = el("span", "main");
      if (m.badge) main.append(m.badge);
      main.append(el("span", m.isNew ? "new" : "", m.label));
      li.append(main);
      if (m.sub) li.append(el("span", "sub", m.sub));
      li.addEventListener("pointerdown", (e) => { e.preventDefault(); pick(i); });
      return { ...m, el: li };
    });
    if (!items.length) return close();
    list.replaceChildren(...items.map((i) => i.el)); list.hidden = false;
    input.setAttribute("aria-expanded", "true"); active = -1; mark();
  }
  function pick(i) {
    const it = items[i]; if (!it) return;
    input.value = it.value; onPick && onPick(it);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
  }
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); return pick(active); }
    else if (e.key === "Escape") { e.preventDefault(); return close(); }
    else return;
    input.setAttribute("aria-activedescendant", items[active].el.id); items[active].el.scrollIntoView({ block: "nearest" }); mark();
  });
}

function plateMatches(raw) {
  const q = sKey(raw), cleared = clearedPlates();
  const res = allPlates().map((p) => ({ p, k: sKey(p.plate) })).filter((x) => x.k.includes(q))
    .sort((a, b) => rank(a.k, q) - rank(b.k, q) || a.k.length - b.k.length || (cleared.has(a.p.plate) - cleared.has(b.p.plate)) || a.p.plate.localeCompare(b.p.plate))
    .slice(0, 8)
    .map(({ p }) => ({
      value: p.plate, label: p.plate, plate: p, badge: badge(TYPES[typeOf(p.type)], TYPE_COLOR[typeOf(p.type)], "small"),
      sub: [(p.lines || []).slice(0, 4).join(", "), cleared.has(p.plate) ? "already ridden" : "not ridden yet"].filter(Boolean).join(" · "),
    }));
  const norm = normPlate(raw);
  if (!allPlates().some((p) => p.plate === norm)) res.push({ value: norm, label: `Add "${norm}" as a new plate`, isNew: true });
  return res;
}

function lineMatches(raw) {
  const q = sKey(raw), cleared = clearedLines();
  const res = allLines().filter((l) => sKey(l.id).includes(q))
    .sort((a, b) => ((sKey(b.id) === q) - (sKey(a.id) === q)) || (sKey(b.id).startsWith(q) - sKey(a.id).startsWith(q)) || a.id.localeCompare(b.id, "hu", { numeric: true }))
    .slice(0, 8)
    .map((l) => ({ value: l.id, label: TYPES[typeOf(l.type)], badge: badge(l.id, lineColors(l)), sub: cleared.has(l.id) ? "already ridden" : "not ridden yet" }));
  const norm = normLine(raw);
  if (!allLines().some((l) => l.id === norm)) res.push({ value: norm, label: `Add "${norm}" as a new line`, isNew: true });
  return res;
}

attachSuggest($("line"), $("line-sug"), lineMatches);
attachSuggest($("plate"), $("plate-sug"), plateMatches, (it) => {
  // A plate that has only ever been seen on one line fills the line for you.
  if (it.plate && !$("line").value.trim() && it.plate.lines && it.plate.lines.length === 1) $("line").value = it.plate.lines[0];
});

// ---------- views ----------
function show(view, focusHeading = true) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  document.querySelectorAll("#tabs button").forEach((b) => (b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  render(view);
  if (focusHeading) $("h-" + view).focus();
  window.scrollTo(0, 0);
}

function render(view) {
  if (view === "lines") renderMissing("lines");
  if (view === "plates") renderMissing("plates");
  if (view === "progress") renderProgress();
  if (view === "history") renderHistory();
}

function renderChips(kind) {
  const box = document.querySelector(`.chips[data-for="${kind}"]`);
  box.replaceChildren(...Object.entries(TYPES).map(([k, label]) => {
    const b = el("button", "", label); b.type = "button"; b.setAttribute("aria-pressed", String(filters[kind] === k));
    b.onclick = () => { filters[kind] = k; renderMissing(kind); document.querySelector(`.chips[data-for="${kind}"] button[aria-pressed=true]`).focus(); };
    return b;
  }));
}

const byName = (a, b) => a.localeCompare(b, "hu", { numeric: true });
function lineChip(l) { return badge(l.id, lineColors(l), "chip"); }
function plateChip(p) { const s = el("span", "item plate", p.plate); s.style.borderLeftColor = "#" + TYPE_COLOR[typeOf(p.type)][0]; return s; }

function renderMissing(kind) {
  renderChips(kind);
  const q = $("q-" + kind).value.trim().toUpperCase().replace(/\s+/g, "");
  const cleared = kind === "lines" ? clearedLines() : clearedPlates();
  const items = (kind === "lines" ? allLines().map((l) => ({ k: l.id, type: l.type, o: l })) : allPlates().map((p) => ({ k: p.plate, type: p.type, o: p })))
    .filter((i) => !cleared.has(i.k) && (filters[kind] === "ALL" || typeOf(i.type) === filters[kind]) && (!q || i.k.replace(/\s+/g, "").includes(q)));
  const host = $("list-" + kind);
  if (!items.length) { host.replaceChildren(el("p", "empty", "Nothing missing here.")); return; }
  const groups = {};
  items.forEach((i) => (groups[typeOf(i.type)] ||= []).push(i));
  host.replaceChildren(...Object.entries(groups).map(([t, list]) => {
    const g = el("div", "group"); g.append(el("h2", "", `${TYPES[t]} (${list.length})`));
    const box = el("div", "items");
    list.sort((a, b) => byName(a.k, b.k)).forEach((i) => box.append(kind === "lines" ? lineChip(i.o) : plateChip(i.o)));
    g.append(box); return g;
  }));
}

function bar(label, done, total, color) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const d = el("div", "stat");
  const t = el("div", "", `${label}: `); t.append(el("b", "", `${done}/${total}`), ` (${pct}%)`);
  const b = el("div", "bar"); b.setAttribute("role", "progressbar"); b.setAttribute("aria-label", label);
  b.setAttribute("aria-valuemin", "0"); b.setAttribute("aria-valuemax", "100"); b.setAttribute("aria-valuenow", String(pct));
  const i = el("i"); i.style.width = pct + "%"; if (color) i.style.background = "#" + color;
  b.append(i); d.append(t, b); return d;
}

function renderProgress() {
  const L = allLines(), P = allPlates(), cl = clearedLines(), cp = clearedPlates();
  const ld = L.filter((l) => cl.has(l.id)).length, pd = P.filter((p) => cp.has(p.plate)).length;
  $("progress").replaceChildren(bar("Overall", ld + pd, L.length + P.length), bar("Lines", ld, L.length), bar("Plates", pd, P.length));

  // One expandable section per type: its bars and what is still left to ride.
  const open = new Set([...document.querySelectorAll("#by-type details[open]")].map((d) => d.dataset.type));
  const sections = Object.keys(TYPES).filter((t) => t !== "ALL").map((t) => {
    const lt = L.filter((l) => typeOf(l.type) === t), pt = P.filter((p) => typeOf(p.type) === t);
    if (!lt.length && !pt.length) return null;
    const color = TYPE_COLOR[t][0];
    const d = el("details"); d.dataset.type = t;
    const sum = el("summary"); sum.append(badge(TYPES[t], TYPE_COLOR[t]));
    const ldone = lt.filter((l) => cl.has(l.id)).length, pdone = pt.filter((p) => cp.has(p.plate)).length;
    sum.append(el("span", "sumtext", `${ldone}/${lt.length} lines · ${pdone}/${pt.length} plates`));
    d.append(sum);
    const fill = () => {
      const body = el("div", "typebody");
      if (lt.length) body.append(bar(`${TYPES[t]} lines`, ldone, lt.length, color));
      if (pt.length) body.append(bar(`${TYPES[t]} plates`, pdone, pt.length, color));
      const ml = lt.filter((l) => !cl.has(l.id)).sort((a, b) => byName(a.id, b.id)), mp = pt.filter((p) => !cp.has(p.plate)).sort((a, b) => byName(a.plate, b.plate));
      body.append(el("h3", "", `Lines left (${ml.length})`));
      const a = el("div", "items"); ml.forEach((l) => a.append(lineChip(l))); body.append(a);
      body.append(el("h3", "", `Plates left (${mp.length})`));
      const b = el("div", "items"); mp.forEach((p) => b.append(plateChip(p))); body.append(b);
      d.append(body);
    };
    let filled = false;
    d.addEventListener("toggle", () => { if (d.open && !filled) { filled = true; fill(); } });
    if (open.has(t)) { d.open = true; filled = true; fill(); }
    return d;
  }).filter(Boolean);
  $("by-type").replaceChildren(...sections);

  // Daily: first entry per line/plate decides the day it was cleared.
  const asc = [...entries].sort((a, b) => a.time.localeCompare(b.time));
  const seenL = new Set(), seenP = new Set(), days = {};
  asc.forEach((e) => {
    const d = (days[e.time.slice(0, 10)] ||= { l: 0, p: 0 });
    const l = normLine(e.line), p = normPlate(e.plate);
    if (l && !seenL.has(l)) { seenL.add(l); d.l++; }
    if (p && !seenP.has(p)) { seenP.add(p); d.p++; }
  });
  document.querySelector("#daily tbody").replaceChildren(...Object.keys(days).sort().reverse().map((d) => {
    const tr = el("tr");
    [d, days[d].l, days[d].p].forEach((v) => tr.append(el("td", "", String(v))));
    return tr;
  }));
}

function renderHistory() {
  const ul = $("history");
  if (!entries.length) { ul.replaceChildren(el("li", "empty", "No rides saved yet.")); return; }
  ul.replaceChildren(...entries.map((e) => {
    const li = el("li");
    const t = el("div", "head"); t.append(lineBadge(e.line), el("strong", "", e.plate));
    if (e.dir) t.append(el("span", "meta", `to ${e.dir}`));
    li.append(t, el("div", "meta", new Date(e.time).toLocaleString()));
    if (e.stops.length) li.append(el("div", "meta", "Stops: " + e.stops.join(" → ")));
    if (e.notes) li.append(el("div", "", e.notes));
    const pics = el("div");
    e.photos.forEach((b) => { const i = el("img"); i.src = URL.createObjectURL(b); i.alt = `Photo of ${e.plate}`; i.loading = "lazy"; pics.append(i); });
    li.append(pics);
    const a = el("div", "actions");
    const eb = el("button", "", "Edit"), db_ = el("button", "", "Delete");
    eb.type = db_.type = "button";
    eb.onclick = () => startEdit(e);
    db_.onclick = async () => {
      if (!confirm(`Delete ride on line ${e.line} (${e.plate})?`)) return;
      await del("entries", e.id); await reload(); renderHistory();
      ($("history").querySelector("button") || $("h-history")).focus();
    };
    a.append(eb, db_); li.append(a); return li;
  }));
}

// ---------- form ----------
const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localNow = () => toLocalInput(new Date());
const parseStops = (s) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
function msg(text, err) { const m = $("msg"); m.textContent = text; m.className = err ? "err" : ""; }

// Draft: everything typed or attached is kept, so a camera app or a restart never loses it.
let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    if (editing) return;
    const fields = { line: $("line").value, plate: $("plate").value, when: $("when").value, stops: $("stops").value, notes: $("notes").value, dir: pick.dir, from: pick.from, to: pick.to, edited: pick.edited };
    try { await put("drafts", { key: "form", fields, photos: await Promise.all(photos.map((p) => packPhoto(p.blob))) }); } catch { /* draft is best effort */ }
  }, 300);
}
async function restoreDraft() {
  const d = await getOne("drafts", "form");
  if (!d) return;
  const f = d.fields;
  $("line").value = f.line || ""; $("plate").value = f.plate || ""; $("when").value = f.when || localNow();
  $("notes").value = f.notes || "";
  buildPicker();
  if (pick.data) {
    pick.dir = Math.min(f.dir || 0, pick.data.length - 1); fillSelects();
    pick.from = f.from || 0; pick.to = f.to ?? pick.data[pick.dir].s.length - 1;
    $("from").value = String(pick.from); $("to").value = String(pick.to); renderDirs();
  }
  $("stops").value = f.stops || ""; pick.edited = !!f.edited;
  photos = (d.photos || []).map((p) => { const b = unpackPhoto(p); return { blob: b, url: URL.createObjectURL(b) }; });
  renderThumbs();
}
const clearDraft = () => del("drafts", "form").catch(() => {});
["line", "plate", "when", "stops", "notes"].forEach((id) => $(id).addEventListener("input", saveDraft));

// Photos: a "+" tile opens a small sheet with camera and gallery.
function renderThumbs() {
  const tiles = photos.map((p, i) => {
    const li = el("li");
    const img = el("img"); img.src = p.url; img.alt = `Attached photo ${i + 1}`;
    const b = el("button", "", "×"); b.type = "button"; b.setAttribute("aria-label", `Remove photo ${i + 1}`);
    b.onclick = () => {
      URL.revokeObjectURL(p.url); photos.splice(i, 1); renderThumbs(); saveDraft();
      ($("thumbs").querySelector("li button") || $("add-photo")).focus();
    };
    li.append(img, b); return li;
  });
  const add = el("li"); const ab = el("button", "add", "+"); ab.id = "add-photo"; ab.type = "button"; ab.setAttribute("aria-label", "Add photo");
  ab.onclick = () => $("photo-sheet").showModal();
  add.append(ab);
  $("thumbs").replaceChildren(...tiles, add);
}

const native = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable && Capacitor.isPluginAvailable("Camera"));
function downscale(file) {
  return new Promise((res) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => res(b || file), "image/jpeg", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(file); };
    img.src = url;
  });
}
async function addFiles(files) {
  for (const f of files) { const b = await downscale(f); photos.push({ blob: b, url: URL.createObjectURL(b) }); }
  renderThumbs(); msg(""); saveDraft(); $("add-photo").focus();
}
async function addFrom(source) {
  $("photo-sheet").close();
  if (native()) {
    try {
      const paths = source === "camera"
        ? [(await Capacitor.nativePromise("Camera", "getPhoto", { quality: 85, resultType: "uri", source: "CAMERA", correctOrientation: true })).webPath]
        : (await Capacitor.nativePromise("Camera", "pickImages", { quality: 85, limit: 10 })).photos.map((p) => p.webPath);
      return addFiles(await Promise.all(paths.map((u) => fetch(u).then((r) => r.blob()))));
    } catch (e) {
      if (/cancel/i.test(String(e && (e.message || e)))) return $("add-photo").focus();
      // otherwise fall through to the browser pickers
    }
  }
  $(source === "camera" ? "photo-camera" : "photo-gallery").click();
}
$("pick-camera").onclick = () => addFrom("camera");
$("pick-gallery").onclick = () => addFrom("gallery");
$("pick-cancel").onclick = () => $("photo-sheet").close();
["photo-camera", "photo-gallery"].forEach((id) => $(id).addEventListener("change", async (ev) => { await addFiles(ev.target.files); ev.target.value = ""; }));

// ---------- direction and stops ----------
const pick = { data: null, dir: 0, from: 0, to: 0, edited: false, pos: null };
const stopName = (idx) => stopData.stops[idx][0];
const dist = (a, b) => {
  const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function nearest(dirIdx) {
  if (!pick.pos) return null;
  let best = null;
  pick.data[dirIdx].s.forEach((idx, i) => {
    const s = stopData.stops[idx], m = dist(pick.pos, [s[1], s[2]]);
    if (!best || m < best.m) best = { i, m };
  });
  return best;
}

function buildPicker() {
  const data = stopData.lines[normLine($("line").value)] || null;
  $("stop-picker").hidden = !data;
  if (pick.data === data) return;
  pick.data = data; pick.dir = 0; pick.edited = false; pick.pos = null;
  $("gps-msg").textContent = "";
  if (!data) return;
  fillSelects(); pick.from = 0; pick.to = data[0].s.length - 1; $("to").value = String(pick.to); renderDirs(); applyStops();
}
function fillSelects() {
  const opts = () => pick.data[pick.dir].s.map((idx, i) => { const o = el("option", "", stopName(idx)); o.value = String(i); return o; });
  $("from").replaceChildren(...opts());
  $("to").replaceChildren(...opts());
}
function renderDirs() {
  $("dirs").replaceChildren(...pick.data.map((d, i) => {
    const n = nearest(i);
    const lab = el("label", "dir"); const r = el("input"); r.type = "radio"; r.name = "dir"; r.checked = i === pick.dir;
    r.onchange = () => selectDir(i);
    const t = el("span", "dirtext");
    t.append(el("strong", "", `To ${d.to}`), el("span", "sub", `${stopName(d.s[0])} to ${stopName(d.s[d.s.length - 1])}, ${d.s.length} stops`));
    if (n) t.append(el("span", "sub near", `Nearest stop: ${stopName(d.s[n.i])} (${Math.round(n.m)} m)`));
    lab.append(r, t); return lab;
  }));
}
function selectDir(i) {
  pick.dir = i; fillSelects();
  const n = nearest(i);
  pick.from = n ? n.i : 0; pick.to = pick.data[i].s.length - 1; pick.edited = false;
  $("from").value = String(pick.from); $("to").value = String(pick.to);
  renderDirs(); applyStops(); saveDraft();
}
function applyStops() {
  if (pick.edited || !pick.data) return;
  const s = pick.data[pick.dir].s, a = Math.min(pick.from, pick.to), b = Math.max(pick.from, pick.to);
  $("stops").value = s.slice(a, b + 1).map(stopName).join("\n");
}
$("from").onchange = () => { pick.from = +$("from").value; pick.edited = false; applyStops(); saveDraft(); };
$("to").onchange = () => { pick.to = +$("to").value; pick.edited = false; applyStops(); saveDraft(); };
$("stops").addEventListener("input", () => { pick.edited = true; });
$("line").addEventListener("input", () => { buildPicker(); saveDraft(); });

function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("no GPS"));
    navigator.geolocation.getCurrentPosition((p) => res([p.coords.latitude, p.coords.longitude]), rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  });
}
async function useLocation(which) {
  const m = $("gps-msg"); m.textContent = "Finding you...";
  try { pick.pos = await locate(); } catch { m.textContent = "Could not get your location. Pick the stop from the list."; return; }
  if (which === "from") {
    // Both directions show their nearest stop; pick the direction whose stop is clearly closer.
    const n = pick.data.map((_, i) => nearest(i));
    if (pick.data.length === 2 && Math.abs(n[0].m - n[1].m) > 100) pick.dir = n[0].m < n[1].m ? 0 : 1;
    fillSelects();
    pick.from = nearest(pick.dir).i; pick.to = pick.data[pick.dir].s.length - 1;
  } else {
    pick.to = nearest(pick.dir).i;
  }
  pick.edited = false; $("from").value = String(pick.from); $("to").value = String(pick.to);
  renderDirs(); applyStops(); saveDraft();
  const n = nearest(pick.dir);
  m.textContent = `Nearest stop on this direction: ${stopName(pick.data[pick.dir].s[n.i])} (${Math.round(n.m)} m).`;
}
$("gps-from").onclick = () => useLocation("from");
$("gps-to").onclick = () => useLocation("to");

// ---------- save / edit ----------
function resetForm() {
  editing = null;
  $("form").reset();
  photos.forEach((p) => URL.revokeObjectURL(p.url)); photos = []; renderThumbs();
  pick.data = null; buildPicker();
  $("when").value = localNow();
  $("cancel-edit").hidden = true; $("save").textContent = "Save ride"; $("h-log").textContent = "Log a ride";
}

function startEdit(e) {
  resetForm(); editing = e;
  $("line").value = e.line; $("plate").value = e.plate; $("when").value = toLocalInput(new Date(e.time));
  buildPicker();
  if (pick.data && e.dir) { const i = pick.data.findIndex((d) => d.to === e.dir); if (i >= 0) { pick.dir = i; fillSelects(); renderDirs(); } }
  $("stops").value = e.stops.join("\n"); pick.edited = true; $("notes").value = e.notes;
  photos = e.photos.map((b) => ({ blob: b, url: URL.createObjectURL(b) })); renderThumbs();
  $("cancel-edit").hidden = false; $("save").textContent = "Update ride"; $("h-log").textContent = "Edit ride";
  show("log");
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const line = normLine($("line").value), plate = normPlate($("plate").value);
  if (!line) { msg("Enter the line.", true); return $("line").focus(); }
  if (!plate) { msg("Enter the license plate.", true); return $("plate").focus(); }
  if (!$("when").value) { msg("Enter the date and time.", true); return $("when").focus(); }
  if (!photos.length) { msg("Add at least one photo before saving.", true); return $("add-photo").focus(); }

  // Unknown line/plate: remember it so it counts and shows up in the search.
  if (!allLines().some((l) => l.id === line)) await put("extras", { key: "line:" + line, kind: "line", value: line, type: "OTHER" });
  if (!allPlates().some((p) => p.plate === plate)) await put("extras", { key: "plate:" + plate, kind: "plate", value: plate, type: allLines().find((l) => l.id === line)?.type || "OTHER" });

  const entry = {
    line, plate, time: new Date($("when").value).toISOString(),
    dir: pick.data ? pick.data[pick.dir].to : "",
    stops: parseStops($("stops").value), notes: $("notes").value.trim(), photos: await Promise.all(photos.map((p) => packPhoto(p.blob))),
  };
  if (editing) entry.id = editing.id;
  try { await put("entries", entry); } catch { return msg("Could not save on this device (storage blocked or full).", true); }
  await reload(); await clearDraft();
  resetForm();
  msg("Saved.", false);
  $("line").focus();
});

$("cancel-edit").onclick = () => { resetForm(); show("log"); $("line").focus(); };

// ---------- backup ----------
const toDataUrl = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
$("export").onclick = async () => {
  const out = [];
  for (const e of entries) out.push({ ...e, photos: await Promise.all(e.photos.map(toDataUrl)) });
  const blob = new Blob([JSON.stringify({ version: 1, entries: out, extras })], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `bkv-challenge-${localNow().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};
$("import-btn").onclick = () => $("import").click();
$("import").addEventListener("change", async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    for (const x of d.extras || []) await put("extras", x);
    for (const e of d.entries || []) {
      delete e.id;
      e.photos = await Promise.all((e.photos || []).map((u) => fetch(u).then((r) => r.blob()).then(packPhoto)));
      await put("entries", e);
    }
    await reload(); renderProgress(); alert(`Imported ${(d.entries || []).length} rides.`);
  } catch { alert("That file is not a valid backup."); }
  ev.target.value = ""; $("export").focus();
});

// ---------- boot ----------
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { show(b.dataset.view); b.focus(); }));
["lines", "plates"].forEach((k) => $("q-" + k).addEventListener("input", () => renderMissing(k)));

(async function init() {
  db = await openDb();
  [catalog, stopData] = await Promise.all([loadCatalog(), loadStops()]);
  await reload();
  resetForm();
  await restoreDraft();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
