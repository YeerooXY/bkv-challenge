"use strict";
// Small slippy map: raster tiles from the configured provider, markers, zoom buttons.
// It needs the network. Callers keep the same facts as text and get cfg.onError() when a tile fails.
// Each pin carries a letter and the legend names it in text, so the map does not rely on color alone.
const KINDS = { stop: ["S", "stop"], vehicle: ["V", "vehicle"], me: ["Y", "you"] };
function createMiniMap(host, points, cfg) {
  const T = 256, H = 240, W = Math.max(240, host.clientWidth || 320), N = (z) => 2 ** z;
  const proj = (lat, lon, z) => {
    const s = T * N(z), r = (lat * Math.PI) / 180;
    return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
  };
  const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
  const mid = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
  let z = 17;
  while (z > 10) {
    const a = proj(Math.max(...lats), Math.min(...lons), z), b = proj(Math.min(...lats), Math.max(...lons), z);
    if (b[0] - a[0] < W - 80 && b[1] - a[1] < H - 80) break;
    z--;
  }
  const view = document.createElement("div"), bar = document.createElement("div"), credit = document.createElement("p");
  view.className = "mm-view"; view.style.height = H + "px"; bar.className = "row mm-zoom"; credit.className = "sub";
  const legend = document.createElement("p");
  legend.className = "sub"; legend.textContent = [...new Set(points.map((p) => p.kind))].map((k) => `${KINDS[k][0]} ${KINDS[k][1]}`).join(". ") + ".";
  if (cfg.attributionUrl && cfg.attribution) {
    const a = document.createElement("a"); a.href = cfg.attributionUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = cfg.attribution; credit.append(a);
  } else credit.textContent = cfg.attribution || "";
  let failed = false;
  const draw = () => {
    const [cx, cy] = proj(mid[0], mid[1], z), x0 = cx - W / 2, y0 = cy - H / 2, kids = [];
    for (let tx = Math.floor(x0 / T); tx <= Math.floor((x0 + W) / T); tx++) {
      for (let ty = Math.floor(y0 / T); ty <= Math.floor((y0 + H) / T); ty++) {
        if (ty < 0 || ty >= N(z)) continue;
        const img = document.createElement("img");
        img.alt = ""; img.draggable = false; img.className = "mm-tile"; img.style.left = tx * T - x0 + "px"; img.style.top = ty * T - y0 + "px";
        img.src = cfg.tiles.replace("{z}", z).replace("{x}", ((tx % N(z)) + N(z)) % N(z)).replace("{y}", ty);
        img.onerror = () => { if (!failed) { failed = true; cfg.onError && cfg.onError(); } };
        kids.push(img);
      }
    }
    points.forEach((p) => {
      const [px, py] = proj(p.lat, p.lon, z), pin = document.createElement("span");
      pin.className = "mm-pin " + p.kind; pin.textContent = KINDS[p.kind][0]; pin.setAttribute("aria-hidden", "true"); pin.style.left = px - x0 + "px"; pin.style.top = py - y0 + "px";
      kids.push(pin);
    });
    view.replaceChildren(...kids);
  };
  [["+", "Zoom in", 1], ["−", "Zoom out", -1]].forEach(([t, label, d]) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.setAttribute("aria-label", label);
    b.onclick = () => { z = Math.min(18, Math.max(8, z + d)); draw(); };
    bar.append(b);
  });
  draw();
  host.replaceChildren(view, bar, legend, credit);
}
