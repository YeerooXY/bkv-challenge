"use strict";
// BKV Challenge: offline-first ride log. Data lives in IndexedDB on this device only.

const $ = (id) => document.getElementById(id);
const TYPES = { ALL: "All", BUS: "Bus", TRAM: "Tram", TROLLEYBUS: "Trolley", HEV: "HEV", SUBWAY: "Metro", FERRY: "Ferry", OTHER: "Other" };
const typeOf = (t) => (TYPES[t] && t !== "ALL" ? t : "OTHER");
const normLine = (s) => s.trim().toUpperCase();
const normPlate = (s) => s.replace(/\s+/g, "").toUpperCase();

let catalog = { lines: [], plates: [] };
let entries = [];
let extras = [];
let editing = null; // entry being edited
let photos = []; // [{blob, url}] for the form
const filters = { lines: "ALL", plates: "ALL" };

// ---------- IndexedDB ----------
let db;
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("bkv-challenge", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("entries", { keyPath: "id", autoIncrement: true });
      r.result.createObjectStore("extras", { keyPath: "key" });
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
const put = (store, v) => tx(store, "readwrite", (s) => s.put(v));
// Photos are stored as raw bytes: Safari/WebKit can reject Blobs in IndexedDB.
const packPhoto = async (b) => ({ type: b.type || "image/jpeg", data: await b.arrayBuffer() });
const del = (store, k) => tx(store, "readwrite", (s) => s.delete(k));

async function reload() {
  entries = (await getAll("entries"))
    .map((e) => ({ ...e, photos: e.photos.map((p) => (p instanceof Blob ? p : new Blob([p.data], { type: p.type }))) }))
    .sort((a, b) => b.time.localeCompare(a.time));
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

// ---------- smart search ----------
// Matching ignores spaces/case and treats the letter O and digit 0 as the same character.
const sKey = (t) => t.replace(/[\s-]+/g, "").toUpperCase().replace(/O/g, "0");

function attachSuggest(input, list, getMatches, onPick) {
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  const mark = () => items.forEach((it, i) => { it.el.setAttribute("aria-selected", String(i === active)); });
  function render() {
    const raw = input.value.trim();
    if (!raw) return close();
    items = getMatches(raw).map((m, i) => {
      const el = document.createElement("li"); el.id = `${list.id}-${i}`; el.setAttribute("role", "option");
      const main = document.createElement("span"); main.textContent = m.label;
      el.append(main);
      if (m.sub) el.append(Object.assign(document.createElement("span"), { className: "sub", textContent: m.sub }));
      if (m.isNew) main.className = "new";
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); pick(i); });
      return { ...m, el };
    });
    if (!items.length) return close();
    list.replaceChildren(...items.map((i) => i.el)); list.hidden = false;
    input.setAttribute("aria-expanded", "true"); active = -1; mark();
  }
  function pick(i) { const it = items[i]; if (!it) return; input.value = it.value; close(); onPick && onPick(it); }
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

// Riders usually type the start or the last digits of a plate.
const rank = (k, q) => (k.startsWith(q) ? 0 : k.endsWith(q) ? 1 : 2);

function plateMatches(raw) {
  const q = sKey(raw), cleared = clearedPlates();
  const res = allPlates().map((p) => ({ p, k: sKey(p.plate) })).filter((x) => x.k.includes(q))
    .sort((a, b) => rank(a.k, q) - rank(b.k, q) || a.k.length - b.k.length || (cleared.has(a.p.plate) - cleared.has(b.p.plate)) || a.p.plate.localeCompare(b.p.plate))
    .slice(0, 8)
    .map(({ p }) => ({
      value: p.plate, label: p.plate, plate: p,
      sub: [TYPES[typeOf(p.type)], (p.lines || []).slice(0, 4).join(", "), cleared.has(p.plate) ? "already ridden" : "not ridden yet"].filter(Boolean).join(" · "),
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
    .map((l) => ({ value: l.id, label: l.id, sub: `${TYPES[typeOf(l.type)]} · ${cleared.has(l.id) ? "already ridden" : "not ridden yet"}` }));
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
  document.querySelectorAll("#tabs button").forEach((b) => b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
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
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.setAttribute("aria-pressed", String(filters[kind] === k));
    b.onclick = () => { filters[kind] = k; renderMissing(kind); document.querySelector(`.chips[data-for="${kind}"] button[aria-pressed=true]`).focus(); };
    return b;
  }));
}

function renderMissing(kind) {
  renderChips(kind);
  const q = $("q-" + kind).value.trim().toUpperCase().replace(/\s+/g, "");
  const cleared = kind === "lines" ? clearedLines() : clearedPlates();
  const items = (kind === "lines" ? allLines().map((l) => ({ k: l.id, type: l.type })) : allPlates().map((p) => ({ k: p.plate, type: p.type })))
    .filter((i) => !cleared.has(i.k) && (filters[kind] === "ALL" || typeOf(i.type) === filters[kind]) && (!q || i.k.replace(/\s+/g, "").includes(q)));
  const host = $("list-" + kind);
  if (!items.length) { host.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: "Nothing missing here." })); return; }
  const groups = {};
  items.forEach((i) => (groups[typeOf(i.type)] ||= []).push(i.k));
  host.replaceChildren(...Object.entries(groups).map(([t, ks]) => {
    const g = document.createElement("div"); g.className = "group";
    const h = document.createElement("h2"); h.textContent = `${TYPES[t]} (${ks.length})`;
    const ul = document.createElement("div"); ul.className = "items";
    ks.sort((a, b) => a.localeCompare(b, "hu", { numeric: true })).forEach((k) => {
      const s = document.createElement("span"); s.className = "item"; s.textContent = k; ul.append(s);
    });
    g.append(h, ul); return g;
  }));
}

function bar(label, done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const d = document.createElement("div"); d.className = "stat";
  d.innerHTML = `<div>${label}: <b>${done}/${total}</b> (${pct}%)</div><div class="bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
  return d;
}

function renderProgress() {
  const L = allLines(), P = allPlates(), cl = clearedLines(), cp = clearedPlates();
  const ld = L.filter((l) => cl.has(l.id)).length, pd = P.filter((p) => cp.has(p.plate)).length;
  const nodes = [bar("Overall", ld + pd, L.length + P.length), bar("Lines", ld, L.length), bar("Plates", pd, P.length)];
  Object.keys(TYPES).filter((t) => t !== "ALL").forEach((t) => {
    const lt = L.filter((l) => typeOf(l.type) === t), pt = P.filter((p) => typeOf(p.type) === t);
    if (lt.length) nodes.push(bar(`${TYPES[t]} lines`, lt.filter((l) => cl.has(l.id)).length, lt.length));
    if (pt.length) nodes.push(bar(`${TYPES[t]} plates`, pt.filter((p) => cp.has(p.plate)).length, pt.length));
  });
  $("progress").replaceChildren(...nodes);

  // Daily: first entry per line/plate decides the day it was cleared.
  const day = (e) => e.time.slice(0, 10);
  const asc = [...entries].sort((a, b) => a.time.localeCompare(b.time));
  const seenL = new Set(), seenP = new Set(), days = {};
  asc.forEach((e) => {
    const d = (days[day(e)] ||= { l: 0, p: 0 });
    const l = normLine(e.line), p = normPlate(e.plate);
    if (l && !seenL.has(l)) { seenL.add(l); d.l++; }
    if (p && !seenP.has(p)) { seenP.add(p); d.p++; }
  });
  const rows = Object.keys(days).sort().reverse().map((d) => {
    const tr = document.createElement("tr");
    [d, days[d].l, days[d].p].forEach((v) => tr.append(Object.assign(document.createElement("td"), { textContent: v })));
    return tr;
  });
  document.querySelector("#daily tbody").replaceChildren(...rows);
}

function renderHistory() {
  const ul = $("history");
  if (!entries.length) { ul.replaceChildren(Object.assign(document.createElement("li"), { className: "empty", textContent: "No rides saved yet." })); return; }
  ul.replaceChildren(...entries.map((e) => {
    const li = document.createElement("li");
    const t = document.createElement("div"); t.innerHTML = "<strong></strong> <span></span>";
    t.firstChild.textContent = `Line ${e.line}`; t.lastChild.textContent = `· ${e.plate}`;
    const m = document.createElement("div"); m.className = "meta"; m.textContent = new Date(e.time).toLocaleString();
    li.append(t, m);
    if (e.stops.length) li.append(Object.assign(document.createElement("div"), { className: "meta", textContent: "Stops: " + e.stops.join(" → ") }));
    if (e.notes) li.append(Object.assign(document.createElement("div"), { textContent: e.notes }));
    const pics = document.createElement("div");
    e.photos.forEach((b) => pics.append(Object.assign(document.createElement("img"), { src: URL.createObjectURL(b), alt: `Photo of ${e.plate}`, loading: "lazy" })));
    li.append(pics);
    const a = document.createElement("div"); a.className = "actions";
    const eb = Object.assign(document.createElement("button"), { type: "button", textContent: "Edit" });
    const db_ = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete" });
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
const localNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toLocalInput = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const parseStops = (s) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

function msg(text, err) { const m = $("msg"); m.textContent = text; m.className = err ? "err" : ""; }

function renderThumbs() {
  $("thumbs").replaceChildren(...photos.map((p, i) => {
    const li = document.createElement("li");
    const img = Object.assign(document.createElement("img"), { src: p.url, alt: `Attached photo ${i + 1}` });
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: "×" });
    b.setAttribute("aria-label", `Remove photo ${i + 1}`);
    b.onclick = () => {
      URL.revokeObjectURL(p.url); photos.splice(i, 1); renderThumbs();
      ($("thumbs").querySelector("button") || $("photos")).focus();
    };
    li.append(img, b); return li;
  }));
}

function resetForm() {
  editing = null;
  $("form").reset();
  photos.forEach((p) => URL.revokeObjectURL(p.url)); photos = []; renderThumbs();
  $("when").value = localNow();
  $("cancel-edit").hidden = true; $("save").textContent = "Save ride"; $("h-log").textContent = "Log a ride";
}

function startEdit(e) {
  resetForm(); editing = e;
  $("line").value = e.line; $("plate").value = e.plate; $("when").value = toLocalInput(e.time);
  $("stops").value = e.stops.join("\n"); $("notes").value = e.notes;
  photos = e.photos.map((b) => ({ blob: b, url: URL.createObjectURL(b) })); renderThumbs();
  $("cancel-edit").hidden = false; $("save").textContent = "Update ride"; $("h-log").textContent = "Edit ride";
  show("log");
}

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

$("photos").addEventListener("change", async (ev) => {
  for (const f of ev.target.files) { const b = await downscale(f); photos.push({ blob: b, url: URL.createObjectURL(b) }); }
  ev.target.value = ""; renderThumbs(); msg("");
});

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const line = normLine($("line").value), plate = normPlate($("plate").value);
  if (!line) { msg("Enter the line.", true); return $("line").focus(); }
  if (!plate) { msg("Enter the license plate.", true); return $("plate").focus(); }
  if (!$("when").value) { msg("Enter the date and time.", true); return $("when").focus(); }
  if (!photos.length) { msg("Add at least one photo before saving.", true); return $("photos").focus(); }

  // Unknown line/plate: remember it so it counts and shows up in autocomplete.
  const known = { line: allLines().some((l) => l.id === line), plate: allPlates().some((p) => p.plate === plate) };
  if (!known.line) await put("extras", { key: "line:" + line, kind: "line", value: line, type: "OTHER" });
  if (!known.plate) await put("extras", { key: "plate:" + plate, kind: "plate", value: plate, type: allLines().find((l) => l.id === line)?.type || "OTHER" });

  const entry = {
    line, plate, time: new Date($("when").value).toISOString(),
    stops: parseStops($("stops").value), notes: $("notes").value.trim(), photos: await Promise.all(photos.map((p) => packPhoto(p.blob))),
  };
  if (editing) entry.id = editing.id;
  try { await put("entries", entry); } catch { return msg("Could not save on this device (storage blocked or full).", true); }
  await reload();
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

// ---------- catalog loading ----------
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

// ---------- boot ----------
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { show(b.dataset.view); b.focus(); }));
["lines", "plates"].forEach((k) => $("q-" + k).addEventListener("input", () => renderMissing(k)));

(async function init() {
  db = await openDb();
  catalog = await loadCatalog();
  await reload();
  resetForm();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
