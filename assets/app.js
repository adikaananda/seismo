/* SeismoID — aplikasi utama */
(() => {
  "use strict";
  const SM = window.SeismoModel;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const BBOX = { minlat: -11, maxlat: 6, minlon: 95, maxlon: 141 };
  const DAY = 86400;

  /* ---------- util ---------- */
  const fmt = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "–" :
    (Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : Number(x)).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtInt = (x) => Number(x).toLocaleString("id-ID");
  const pct = (x, d = 0) => fmt(x * 100, d) + "%";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tzName = (() => { try { return new Intl.DateTimeFormat("id-ID", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value; } catch { return ""; } })();
  const fmtTime = (t) => new Date(t * 1000).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " " + tzName;
  const fmtDate = (t) => new Date(t * 1000).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const fmtUTC = (t) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  function ago(t) {
    const s = Date.now() / 1000 - t;
    if (s < 60) return "baru saja";
    if (s < 3600) return Math.floor(s / 60) + " menit lalu";
    if (s < DAY) return Math.floor(s / 3600) + " jam lalu";
    return Math.floor(s / DAY) + " hari lalu";
  }
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const depthClass = (d) => (d < 70 ? "s" : d <= 300 ? "m" : "d");
  const depthColor = (d) => (d < 70 ? "#e4572e" : d <= 300 ? "#f0a202" : "#2f6fde");
  const depthLabel = (d) => (d < 70 ? "dangkal" : d <= 300 ? "menengah" : "dalam");
  const magClass = (m) => (m < 4.5 ? "m0" : m < 5 ? "m1" : m < 6 ? "m2" : "m3");
  const magWord = (m) => (m < 4 ? "Kecil" : m < 5 ? "Ringan" : m < 6 ? "Sedang" : m < 7 ? "Kuat" : "Besar");
  const magRadius = (m) => Math.max(3.5, 3 + Math.pow(Math.max(m - 3.5, 0.3), 1.6) * 2.4);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return quantile(s, 0.5); };
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
  }
  function lowerBound(arr, x, key) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) < x) lo = m + 1; else hi = m; } return lo; }
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } } };

  function parseCSV(text) {
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
      else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    const head = rows.shift() || [];
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
  }
  const num = (v) => (v === undefined || v === null || v === "" ? null : (Number.isFinite(+v) ? +v : null));
  function usgsRow(r) {
    return {
      src: "usgs", id: r.id, t: Date.parse(r.time) / 1000, lat: num(r.latitude), lon: num(r.longitude), depth: num(r.depth),
      mag: num(r.mag), magType: r.magType || "", gap: num(r.gap), dmin: num(r.dmin), rms: num(r.rms),
      horizontalError: num(r.horizontalError), depthError: num(r.depthError), magError: num(r.magError), magNst: num(r.magNst),
      place: r.place || "", type: r.type || "earthquake", meta: true,
    };
  }

  /* ---------- state ---------- */
  const S = {
    A: null, B: null, ev: null, cat: [], catEnd: 0, bmkgSnap: [],
    usgs: [], usgsMode: "live", bmkg: [], bmkgAuto: null, bmkgMode: "live",
    source: "bmkg", windowDays: 30, selected: null, charts: {}, maps: {}, tiles: [],
  };

  /* ---------- data loading ---------- */
  async function loadStatic() {
    const [A, B, ev, cat, snap] = await Promise.all(["model_A", "model_B", "evaluation", "catalog", "bmkg_snapshot"].map((f) => fetch(`/data/${f}.json`).then((r) => r.json())));
    S.A = A; S.B = B; S.ev = ev; S.bmkgSnap = snap;
    S.cat = cat.t.map((t, i) => ({ t, lat: cat.lat[i], lon: cat.lon[i], depth: cat.d[i], m: cat.m[i], mag: cat.m[i], magType: cat.mt[i], place: cat.p[i], pa: cat.pa[i] }));
    S.catEnd = S.cat[S.cat.length - 1].t;
    for (const k of ["a", "b"]) {
      const p = ev.scatter[k], y = ev.scatter.y;
      S["pool_" + k] = p.map((v, i) => ({ p: v, r: y[i] - v })).sort((x, z) => x.p - z.p);
    }
  }

  async function loadUSGS() {
    const start = new Date(Date.now() - 62 * DAY * 1000).toISOString().slice(0, 19);
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=${start}&minlatitude=${BBOX.minlat}&maxlatitude=${BBOX.maxlat}&minlongitude=${BBOX.minlon}&maxlongitude=${BBOX.maxlon}&minmagnitude=4.5&orderby=time&eventtype=earthquake`;
    try {
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(tm);
      if (!r.ok) throw new Error(r.status);
      const rows = parseCSV(await r.text()).map(usgsRow).filter((e) => e.type === "earthquake" && e.mag !== null && e.lat !== null && e.depth !== null && e.depth >= 0);
      if (!rows.length) throw new Error("kosong");
      S.usgs = rows.sort((a, b) => b.t - a.t); S.usgsMode = "live";
    } catch (e) {
      S.usgs = S.cat.filter((k) => k.t > S.catEnd - 62 * DAY).map((k, i) => ({ src: "usgs", id: "arsip" + i, t: k.t, lat: k.lat, lon: k.lon, depth: k.depth, mag: k.m, magType: k.magType, place: k.place, pa: k.pa, meta: false })).sort((a, b) => b.t - a.t);
      S.usgsMode = "arsip";
    }
  }

  function bmkgParse(g) {
    const [la, lo] = String(g.Coordinates || "").split(",").map(Number);
    return { src: "bmkg", id: g.DateTime + g.Coordinates, t: Date.parse(g.DateTime) / 1000, lat: la, lon: lo, depth: parseFloat(g.Kedalaman), mag: parseFloat(g.Magnitude),
      place: g.Wilayah || "", potensi: g.Potensi || "", dirasakan: g.Dirasakan || "", shakemap: g.Shakemap || "" };
  }
  async function getBMKG(feed) {
    // 1) proxy serverless Vercel, 2) langsung ke BMKG
    for (const u of [`/api/bmkg?feed=${feed}`, `https://data.bmkg.go.id/DataMKG/TEWS/${feed}.json`]) {
      try { const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 9000); const r = await fetch(u, { signal: ctrl.signal }); clearTimeout(tm); if (r.ok) { const j = await r.json(); if (j && j.Infogempa) return j.Infogempa.gempa; } } catch (e) { /* coba berikutnya */ }
    }
    return null;
  }
  async function loadBMKG() {
    const [auto, terkini, dirasakan] = await Promise.all([getBMKG("autogempa"), getBMKG("gempaterkini"), getBMKG("gempadirasakan")]);
    if (terkini || auto || dirasakan) {
      const list = [].concat(terkini || [], dirasakan || [], auto ? [auto] : []).map(bmkgParse).filter((e) => Number.isFinite(e.t) && Number.isFinite(e.lat));
      const seen = new Map(); list.forEach((e) => { const k = e.t + "|" + e.lat.toFixed(2); seen.set(k, Object.assign(seen.get(k) || {}, e)); });
      S.bmkg = [...seen.values()].sort((a, b) => b.t - a.t);
      S.bmkgAuto = auto ? bmkgParse(auto) : S.bmkg[0]; S.bmkgMode = "live";
    } else {
      S.bmkg = S.bmkgSnap.map((g) => ({ src: "bmkg", id: g.time + g.lat, t: Date.parse(g.time.replace(" ", "T")) / 1000, lat: +g.lat, lon: +g.lon, depth: +g.depth, mag: +g.mag, place: g.Wilayah, potensi: g.Potensi, dirasakan: g.Dirasakan, shakemap: "" })).sort((a, b) => b.t - a.t);
      S.bmkgAuto = S.bmkg[0]; S.bmkgMode = "arsip";
    }
  }
  function updateConn() {
    const el = $("#conn"), live = [S.bmkgMode === "live" && "BMKG", S.usgsMode === "live" && "USGS"].filter(Boolean);
    el.className = "conn " + (live.length === 2 ? "ok" : "warn");
    el.querySelector("span").textContent = live.length === 2 ? "Data realtime" : live.length ? live[0] + " realtime" : "Mode arsip";
    el.title = `BMKG: ${S.bmkgMode === "live" ? "terhubung" : "tidak terjangkau, memakai arsip"} · USGS: ${S.usgsMode === "live" ? "terhubung" : "tidak terjangkau, memakai arsip s.d. " + fmtDate(S.catEnd)}`;
  }

  /* ---------- model helpers ---------- */
  function historyCatalog() {
    const extra = S.usgsMode === "live" ? S.usgs.filter((e) => e.t > S.catEnd + 1).map((e) => ({ t: e.t, lat: e.lat, lon: e.lon, m: e.mag, place: e.place, depth: e.depth })) : [];
    return S.cat.concat(extra.sort((a, b) => a.t - b.t));
  }
  let HC = null;
  function hist(ev) {
    HC = HC || historyCatalog();
    const lo = lowerBound(HC, ev.t - 30 * DAY, (k) => k.t), hi = lowerBound(HC, ev.t, (k) => k.t);
    return SM.historyFeatures(ev, HC.slice(lo, hi));
  }
  const estB = (ev) => { const h = hist(ev); return { v: SM.predict(S.B, SM.rowB(ev, h)), h }; };
  function estA(ev) {
    if (!ev.meta) return ev.pa !== undefined ? ev.pa : null;
    return SM.predict(S.A, SM.rowA(ev));
  }
  function interval(k, est, K = 250) {
    const pool = S["pool_" + k]; const i = lowerBound(pool, est, (d) => d.p);
    let lo = Math.max(0, i - K / 2), hi = Math.min(pool.length, lo + K); lo = Math.max(0, hi - K);
    const r = pool.slice(lo, hi).map((d) => d.r).sort((a, b) => a - b);
    return [est + quantile(r, 0.05), est + quantile(r, 0.95)];
  }
  const inRegion = (lat, lon) => lat >= BBOX.minlat && lat <= BBOX.maxlat && lon >= BBOX.minlon && lon <= BBOX.maxlon;
  function ensureEst(e) {
    if (e._b === undefined) { const r = estB(e); e._b = r.v; e._h = r.h; }
    if (e._a === undefined) e._a = e.src === "usgs" ? estA(e) : null;
  }

  /* ---------- theme & maps ---------- */
  let tileFallback = false;
  const tileURL = () => tileFallback
    ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    : `https://{s}.basemaps.cartocdn.com/${document.documentElement.dataset.theme === "dark" ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`;
  function baseMap(el, opts = {}) {
    const m = L.map(el, { preferCanvas: true, scrollWheelZoom: true, ...opts }).setView([-2.5, 118], 5);
    const t = L.tileLayer(tileURL(), { subdomains: "abc", maxZoom: 12, attribution: "© OpenStreetMap © CARTO" }).addTo(m);
    // Bila tile CARTO gagal dimuat (diblokir jaringan/ad-blocker), pindah ke OpenStreetMap.
    let errs = 0, okTiles = 0;
    t.on("tileload", () => { okTiles++; });
    t.on("tileerror", () => {
      if (tileFallback || okTiles > 0 || ++errs < 3) return;
      tileFallback = true;
      document.documentElement.classList.add("tiles-osm");
      S.tiles.forEach((l) => l.setUrl(tileURL()));
    });
    S.tiles.push(t);
    return m;
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t; store.set("seismo-theme", t);
    S.tiles.forEach((l) => l.setUrl(tileURL()));
    chartDefaults();
    if (rendered.analisis) renderAnalisis();
    if (rendered.evaluasi) renderEvaluasi();
  }

  /* ================= GEMPA TERKINI ================= */
  let liveLayer, focusLayer;
  function currentEvents() {
    if (S.source === "bmkg") return S.bmkg;
    const ref = S.usgsMode === "arsip" ? S.catEnd : Date.now() / 1000;
    return S.usgs.filter((e) => e.t >= ref - S.windowDays * DAY);
  }
  function renderMonitor() {
    const evs = currentEvents();
    const arsip = (S.source === "usgs" ? S.usgsMode : S.bmkgMode) === "arsip";
    $("#seg-window").hidden = S.source === "bmkg";
    $("#map-caption").textContent = (S.source === "usgs"
      ? `USGS · magnitudo ≥ 4,5 · ${S.windowDays === 1 ? "24 jam" : S.windowDays + " hari"} terakhir`
      : "BMKG · gempa M 5+ terkini dan gempa dirasakan") + (arsip ? " · data arsip (sumber tidak terjangkau)" : "");

    const k = $("#kpi-live");
    if (!evs.length) k.innerHTML = stat("Jumlah gempa", "0", "Tidak ada gempa pada rentang ini");
    else {
      const big = evs.reduce((a, b) => (b.mag > a.mag ? b : a));
      const shallow = evs.filter((e) => e.depth < 70).length / evs.length;
      k.innerHTML =
        stat("Jumlah gempa", fmtInt(evs.length), S.source === "usgs" ? "Magnitudo ≥ 4,5" : "Dari feed BMKG") +
        stat("Magnitudo terbesar", fmt(big.mag), big.place) +
        stat("Gempa dangkal", pct(shallow), "Kedalaman < 70 km") +
        stat("Gempa terakhir", ago(evs[0].t), `M ${fmt(evs[0].mag)} · ${evs[0].place}`);
    }

    liveLayer.clearLayers();
    [...evs].sort((a, b) => a.mag - b.mag).forEach((e) => {
      const c = L.circleMarker([e.lat, e.lon], { radius: magRadius(e.mag), color: "#ffffff", weight: 1, fillColor: depthColor(e.depth), fillOpacity: 0.8 });
      c.bindTooltip(`<b>M ${fmt(e.mag)}</b> · ${esc(e.place)}<br>${fmtTime(e.t)} · ${fmt(e.depth, 0)} km`, { direction: "top", offset: [0, -4] });
      c.on("click", () => select(e));
      liveLayer.addLayer(c);
    });

    $("#feed-count").textContent = fmtInt(evs.length) + " gempa";
    $("#feed").innerHTML = evs.map((e, i) => `
      <div class="ev ${S.selected && S.selected.id === e.id ? "sel" : ""}" data-i="${i}" role="button" tabindex="0">
        <span class="mag-chip ${magClass(e.mag)}">${fmt(e.mag)}</span>
        <div style="min-width:0"><div class="ev-title" title="${esc(e.place)}">${esc(e.place)}</div>
          <div class="ev-meta">${fmtTime(e.t)} · ${fmt(e.depth, 0)} km</div></div>
      </div>`).join("") || `<div class="empty">Tidak ada gempa.</div>`;
    $$("#feed .ev").forEach((el) => {
      const go = () => select(evs[+el.dataset.i]);
      el.addEventListener("click", go); el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
    });
    renderFeatured();
  }
  const stat = (label, value, note) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note" title="${esc(note)}">${esc(note)}</div></div>`;

  function renderFeatured() {
    const g = S.bmkgAuto, el = $("#bmkg-latest");
    if (!g) { el.innerHTML = `<div class="empty">Memuat data BMKG…</div>`; return; }
    const tsu = /berpotensi tsunami/i.test(g.potensi) && !/tidak/i.test(g.potensi);
    const shake = g.shakemap && S.bmkgMode === "live" ? `https://data.bmkg.go.id/DataMKG/TEWS/${encodeURIComponent(g.shakemap)}` : "";
    el.innerHTML = `
      <div class="featured-mag ${magClass(g.mag)}"><div class="num">${fmt(g.mag)}</div><div class="lbl">Magnitudo</div></div>
      <div style="min-width:0">
        <div class="eyebrow">Gempa terbaru dari BMKG${S.bmkgMode === "arsip" ? " (data arsip)" : ""}</div>
        <h2>${esc(g.place)}</h2>
        <div class="facts">
          <span>Waktu <b>${fmtTime(g.t)}</b></span>
          <span>Kedalaman <b>${fmt(g.depth, 0)} km</b> (${depthLabel(g.depth)})</span>
          <span>Lokasi <b>${fmt(Math.abs(g.lat), 2)}° ${g.lat < 0 ? "LS" : "LU"}, ${fmt(g.lon, 2)}° BT</b></span>
        </div>
        ${g.potensi ? `<span class="badge ${tsu ? "badge-bad" : "badge-ok"}">${esc(g.potensi)}</span>` : ""}
        ${g.dirasakan ? `<p class="sub" style="margin-top:8px">Dirasakan: ${esc(g.dirasakan)}</p>` : ""}
        <div style="margin-top:12px"><button class="btn" id="bmkg-focus">Lihat detail di peta</button></div>
      </div>
      ${shake ? `<a href="${shake}" target="_blank" rel="noopener" title="Buka peta guncangan (shakemap) BMKG"><img class="shake" alt="Shakemap BMKG" loading="lazy" src="${shake}" onerror="this.parentNode.remove()"></a>` : "<span></span>"}`;
    $("#bmkg-focus").onclick = () => {
      S.source = "bmkg"; syncSeg(); renderMonitor();
      select(S.bmkg.find((x) => x.t === g.t) || g);
    };
  }

  function select(e) {
    S.selected = e; ensureEst(e);
    $$("#feed .ev").forEach((el) => el.classList.toggle("sel", currentEvents()[+el.dataset.i] === e));
    const m = S.maps.live; focusLayer.clearLayers();
    L.circle([e.lat, e.lon], { radius: 100000, color: css("--primary"), weight: 1.5, dashArray: "5 5", fillOpacity: 0.05 }).addTo(focusLayer);
    (e._h.near || []).forEach((k) => L.circleMarker([k.lat, k.lon], { radius: 4, color: css("--primary"), weight: 1.5, fillOpacity: 0.3 }).addTo(focusLayer));
    L.circleMarker([e.lat, e.lon], { radius: magRadius(e.mag) + 4, color: css("--text"), weight: 2, fill: false }).addTo(focusLayer);
    m.flyTo([e.lat, e.lon], Math.max(m.getZoom(), 6), { duration: 0.6 });

    const h = e._h, iB = interval("b", e._b);
    const d = $("#detail"); d.hidden = false;
    d.innerHTML = `
      <div class="card-header" style="margin-bottom:20px">
        <div style="display:flex;gap:14px;align-items:center;min-width:0">
          <span class="mag-chip ${magClass(e.mag)}" style="height:44px;min-width:60px;font-size:20px">${fmt(e.mag)}</span>
          <div style="min-width:0"><h2>${esc(e.place)}</h2><p class="sub">${fmtTime(e.t)} · ${fmtUTC(e.t)} · sumber ${e.src.toUpperCase()}</p></div>
        </div>
        <button class="btn close-btn" id="detail-close">Tutup</button>
      </div>
      <div class="detail-grid">
        <div>
          <h3>Informasi Gempa</h3>
          <dl class="dl">
            <dt>Magnitudo</dt><dd>${fmt(e.mag)} ${e.magType ? "(" + esc(e.magType) + ")" : ""} · ${magWord(e.mag)}</dd>
            <dt>Kedalaman</dt><dd>${fmt(e.depth, 0)} km · ${depthLabel(e.depth)}</dd>
            <dt>Koordinat</dt><dd>${fmt(e.lat, 2)}, ${fmt(e.lon, 2)}</dd>
            ${e.potensi ? `<dt>Potensi</dt><dd>${esc(e.potensi)}</dd>` : ""}
            ${e.dirasakan ? `<dt>Dirasakan</dt><dd>${esc(e.dirasakan)}</dd>` : ""}
            <dt>Gempa sekitar</dt><dd>${h.n_30h} gempa dalam 100 km, 30 hari sebelumnya</dd>
          </dl>
        </div>
        <div>
          <h3>Estimasi Model B (lokasi &amp; riwayat)</h3>
          ${resultHTML(e._b, iB, e.mag, "b")}
          <p class="msg msg-muted">Model B kurang akurat (R² 0,02); hasilnya hanya gambaran umum.</p>
          ${e.mag < 4.5 ? `<p class="msg msg-warn">Magnitudo di bawah 4,5 berada di luar rentang data latih.</p>` : ""}
        </div>
        <div>
          <h3>Audit Model A (data kualitas USGS)</h3>
          ${e._a !== null && e._a !== undefined ? resultHTML(e._a, interval("a", e._a), e.mag, "a") + auditMsg(e._a, e.mag)
            : `<p class="msg msg-muted">Model A membutuhkan data kualitas pengukuran (gap, rms, magError, dan lainnya) yang hanya tersedia di katalog USGS. Pilih sumber <b>USGS</b> untuk memakai model ini.</p>`}
        </div>
      </div>`;
    $("#detail-close").onclick = () => { d.hidden = true; focusLayer.clearLayers(); S.selected = null; $$("#feed .ev").forEach((el) => el.classList.remove("sel")); };
    d.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function resultHTML(est, iv, actual, k) {
    const lo = 4, hi = 8, P = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const col = k === "a" ? "var(--model-a)" : "var(--model-b)";
    return `<div class="result">
      <div class="result-top"><span class="result-value" style="color:${col}">M ${fmt(est, 2)}</span><span class="result-range">kemungkinan ${fmt(iv[0], 1)} – ${fmt(iv[1], 1)}</span></div>
      <div class="bar"><div class="bar-band" style="left:${P(iv[0])}%;width:${P(iv[1]) - P(iv[0])}%;border-color:${col}"></div><div class="bar-est" style="left:${P(est)}%;background:${col}"></div>${actual ? `<div class="bar-act" style="left:${P(actual)}%"></div>` : ""}</div>
      <div class="bar-axis"><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span></div>
      <div class="bar-legend"><span><i style="background:${col}"></i>Estimasi (rentang 90%)</span>${actual ? `<span><i style="background:var(--ok)"></i>Tercatat: M ${fmt(actual)}</span>` : ""}</div>
    </div>`;
  }
  function auditMsg(a, mag) {
    return Math.abs(a - mag) <= 0.3
      ? `<p class="msg msg-ok">✓ Wajar. Selisih ${fmt(a - mag, 2)} masih dalam batas ±0,3.</p>`
      : `<p class="msg msg-bad">Selisih ${fmt(a - mag, 2)} melebihi ±0,3, jadi magnitudo ini perlu ditinjau. Pada gempa besar, model memang cenderung memperkirakan lebih kecil.</p>`;
  }
  function syncSeg() {
    $$("#seg-source button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.source));
    $$("#seg-window button").forEach((b) => b.classList.toggle("on", +b.dataset.v === S.windowDays));
  }

  /* ================= ANALISIS ================= */
  const F = { y0: 2015, y1: 2026, mag: 4.5, depth: "all", area: null };
  let histLayer, areaLayer;
  function filtered() {
    const t0 = Date.UTC(F.y0, 0, 1) / 1000, t1 = Date.UTC(F.y1 + 1, 0, 1) / 1000;
    return S.cat.filter((k) => k.t >= t0 && k.t < t1 && k.m >= F.mag - 1e-9 && (F.depth === "all" || depthClass(k.depth) === F.depth) &&
      (!F.area || SM.haversine(F.area.lat, F.area.lon, k.lat, k.lon) <= F.area.r));
  }
  function regionOf(p) {
    let s = p.includes(" of ") ? p.split(" of ").slice(1).join(" of ") : p;
    return s.replace(/,\s*Indonesia$/i, "").trim() || p;
  }
  function bValue(mags, mc) {
    const m = mags.filter((x) => x >= mc - 1e-9); if (m.length < 30) return null;
    const mean = m.reduce((a, b) => a + b, 0) / m.length;
    const b = Math.LOG10E / (mean - (mc - 0.05));
    return { b, se: b / Math.sqrt(m.length), a: Math.log10(m.length) + b * mc };
  }
  function chartDefaults() {
    Chart.defaults.color = css("--text-2"); Chart.defaults.borderColor = css("--border");
    Chart.defaults.font.family = "Inter, system-ui, sans-serif"; Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.plugins.legend.labels.boxHeight = 10; Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.tooltip.backgroundColor = css("--surface"); Chart.defaults.plugins.tooltip.titleColor = css("--text"); Chart.defaults.plugins.tooltip.bodyColor = css("--text-2");
    Chart.defaults.plugins.tooltip.borderColor = css("--border"); Chart.defaults.plugins.tooltip.borderWidth = 1; Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.maintainAspectRatio = false; Chart.defaults.locale = "id-ID"; Chart.defaults.animation.duration = 300;
  }
  function chart(id, cfg) { if (S.charts[id]) S.charts[id].destroy(); S.charts[id] = new Chart($("#" + id), cfg); return S.charts[id]; }

  function renderAnalisis() {
    const d = filtered(), mags = d.map((k) => k.m);
    const bv = bValue(mags, Math.max(4.5, F.mag));
    const big = d.reduce((a, b) => (!a || b.m > a.m ? b : a), null);
    $("#kpi-hist").innerHTML =
      stat("Jumlah gempa", fmtInt(d.length), `${F.y0}–${F.y1}${F.area ? " · wilayah terpilih" : ""}`) +
      stat("Magnitudo terbesar", big ? fmt(big.m) : "–", big ? `${big.place} · ${fmtDate(big.t)}` : "") +
      stat("Rata-rata per bulan", fmt(d.length / Math.max(1, monthsSpan()), 1), `${pct(d.filter((k) => k.depth < 70).length / Math.max(1, d.length))} gempa dangkal`) +
      stat("Nilai-b", bv ? fmt(bv.b, 2) : "–", bv ? "Makin besar berarti gempa kecil makin dominan" : "Butuh minimal 30 gempa");

    histLayer.clearLayers();
    const cell = 0.5, grid = new Map();
    d.forEach((k) => { const key = Math.floor(k.lat / cell) + "," + Math.floor(k.lon / cell); grid.set(key, (grid.get(key) || 0) + 1); });
    const max = Math.max(1, ...grid.values());
    const ramp = ["#fde68a", "#fbbf24", "#f97316", "#dc2626", "#7f1d1d"];
    grid.forEach((n, key) => {
      const [i, j] = key.split(",").map(Number); const f = Math.log(1 + n) / Math.log(1 + max);
      L.rectangle([[i * cell, j * cell], [(i + 1) * cell, (j + 1) * cell]], { stroke: false, fillColor: ramp[Math.min(4, Math.floor(f * 5))], fillOpacity: 0.45 + f * 0.4 })
        .bindTooltip(`${fmtInt(n)} gempa`, { sticky: true }).addTo(histLayer);
    });
    $("#ramp-max").textContent = "1 – " + fmtInt(max);

    const months = [], counts = new Map();
    d.forEach((k) => { const dt = new Date(k.t * 1000); const key = dt.getUTCFullYear() * 12 + dt.getUTCMonth(); counts.set(key, (counts.get(key) || 0) + 1); });
    const endKey = new Date(S.catEnd * 1000).getUTCFullYear() * 12 + new Date(S.catEnd * 1000).getUTCMonth();
    for (let y = F.y0; y <= F.y1; y++) for (let mo = 0; mo < 12; mo++) { const key = y * 12 + mo; if (key <= endKey) months.push(key); }
    const MN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const primary = css("--primary");
    chart("ch-monthly", { type: "bar", data: { labels: months.map((k) => MN[k % 12] + " " + Math.floor(k / 12)), datasets: [{ label: "Gempa", data: months.map((k) => counts.get(k) || 0), backgroundColor: primary, borderRadius: 2, barPercentage: 1, categoryPercentage: 0.85 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } }, y: { beginAtZero: true } } } });

    const mcs = []; for (let m = 4.5; m <= 8.0001; m += 0.1) mcs.push(+m.toFixed(1));
    const cum = mcs.map((m) => mags.filter((x) => x >= m - 1e-9).length);
    const ds = [{ type: "scatter", label: "Jumlah gempa ≥ M", data: mcs.map((m, i) => ({ x: m, y: cum[i] || null })), backgroundColor: primary, pointRadius: 3.5 }];
    if (bv) ds.push({ type: "line", label: "Garis tren", data: [Math.max(4.5, F.mag), 8].map((m) => ({ x: m, y: Math.pow(10, bv.a - bv.b * m) })), borderColor: css("--model-b"), borderDash: [6, 4], borderWidth: 2, pointRadius: 0 });
    $("#gr-note").textContent = bv ? `Setiap kenaikan 1 magnitudo, jumlah gempa turun sekitar ${fmtInt(Math.round(Math.pow(10, bv.b)))} kali (b = ${fmt(bv.b, 2)}).` : "";
    chart("ch-gr", { type: "scatter", data: { datasets: ds }, options: { plugins: { legend: { position: "bottom" } },
      scales: { x: { min: 4.4, max: 8, title: { display: true, text: "Magnitudo" } }, y: { type: "logarithmic", min: 0.8, title: { display: true, text: "Jumlah (skala log)" }, ticks: { callback: (v) => ([1, 10, 100, 1000, 10000].includes(v) ? fmtInt(v) : "") } } } } });

    const edges = [0, 10, 20, 35, 50, 70, 100, 150, 200, 300, 400, 500, 700];
    chart("ch-depth", { type: "bar", data: { labels: edges.slice(0, -1).map((e, i) => `${e}–${edges[i + 1]}`), datasets: [{ label: "Gempa", data: edges.slice(0, -1).map((e, i) => d.filter((k) => k.depth >= e && k.depth < edges[i + 1]).length), backgroundColor: edges.slice(0, -1).map((e) => depthColor(e + 1)), borderRadius: 3 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: "Kedalaman (km)" }, grid: { display: false } }, y: { beginAtZero: true } } } });

    const rc = new Map(); d.forEach((k) => { const r = regionOf(k.place); rc.set(r, (rc.get(r) || 0) + 1); });
    const top = [...rc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), tmax = top[0]?.[1] || 1;
    $("#top-regions").innerHTML = top.map(([r, n]) => `<div class="rank-row"><div>${esc(r)}<div class="rank-bar" style="width:${(n / tmax) * 100}%"></div></div><div class="rank-n">${fmtInt(n)}</div></div>`).join("") || `<div class="empty">Tidak ada data</div>`;

    const bigs = [...d].sort((a, b) => b.m - a.m).slice(0, 20);
    $("#tbl-big").innerHTML = `<thead><tr><th>Tanggal</th><th>Lokasi</th><th class="num">Magnitudo</th><th class="num">Kedalaman</th><th class="num">Estimasi Model A</th><th class="num">Selisih</th></tr></thead><tbody>` +
      bigs.map((k) => `<tr><td>${fmtDate(k.t)}</td><td>${esc(k.place)}</td><td class="num"><span class="mag-chip ${magClass(k.m)}">${fmt(k.m)}</span></td><td class="num">${fmt(k.depth, 0)} km</td><td class="num">${fmt(k.pa, 2)}</td><td class="num ${Math.abs(k.pa - k.m) > 0.3 ? "neg" : "pos"}">${fmt(k.pa - k.m, 2)}</td></tr>`).join("") + "</tbody>";
  }
  function monthsSpan() { const end = Math.min(Date.UTC(F.y1 + 1, 0, 1), (S.catEnd + DAY) * 1000); return (end - Date.UTC(F.y0, 0, 1)) / (30.44 * DAY * 1000); }
  function initAnalisis() {
    const years = []; for (let y = 2015; y <= 2026; y++) years.push(y);
    $("#f-y0").innerHTML = years.map((y) => `<option ${y === F.y0 ? "selected" : ""}>${y}</option>`).join("");
    $("#f-y1").innerHTML = years.map((y) => `<option ${y === F.y1 ? "selected" : ""}>${y}</option>`).join("");
    const m = S.maps.hist = baseMap("map-hist");
    histLayer = L.layerGroup().addTo(m); areaLayer = L.layerGroup().addTo(m);
    m.on("click", (e) => { F.area = { lat: e.latlng.lat, lon: e.latlng.lng, r: 150 }; areaLayer.clearLayers(); L.circle(e.latlng, { radius: 150000, color: css("--primary"), weight: 2, fillOpacity: 0.05 }).addTo(areaLayer); $("#btn-clear-area").hidden = false; renderAnalisis(); });
    $("#btn-clear-area").onclick = () => { F.area = null; areaLayer.clearLayers(); $("#btn-clear-area").hidden = true; renderAnalisis(); };
    const upd = () => { F.y0 = +$("#f-y0").value; F.y1 = Math.max(F.y0, +$("#f-y1").value); $("#f-y1").value = F.y1; F.mag = +$("#f-mag").value; $("#f-mag-v").textContent = fmt(F.mag); F.depth = $("#f-depth").value; renderAnalisis(); };
    ["#f-y0", "#f-y1", "#f-depth"].forEach((s) => $(s).addEventListener("change", upd));
    $("#f-mag").addEventListener("input", () => { $("#f-mag-v").textContent = fmt(+$("#f-mag").value); });
    $("#f-mag").addEventListener("change", upd);
    renderAnalisis();
  }

  /* ================= PREDIKSI ================= */
  const A_FIELDS = [
    ["group", "Lokasi & waktu"], ["lat", "Lintang", 0], ["lon", "Bujur", 1], ["depth", "Kedalaman (km)", 2], ["time", "Waktu (UTC)"],
    ["group", "Kualitas pengukuran"], ["gap", "gap (°)", 7], ["dmin", "dmin (°)", 8], ["rms", "rms (detik)", 9], ["horizontalError", "Galat horizontal (km)", 10],
    ["depthError", "Galat kedalaman (km)", 11], ["magError", "Galat magnitudo", 12], ["magNst", "Jumlah stasiun (magNst)", 13], ["magType", "Tipe magnitudo"],
  ];
  const A_KEYS = ["lat", "lon", "depth", "gap", "dmin", "rms", "horizontalError", "depthError", "magError", "magNst"];
  let pickMarker, pickCircle;
  const toInput = (tSec) => new Date(tSec * 1000).toISOString().slice(0, 16);
  const fromInput = (v) => Date.parse(v + ":00Z") / 1000;

  function initPrediksi() {
    $("#b-time").value = toInput(Date.now() / 1000);
    const mp = S.maps.pick = baseMap("map-pick"); mp.setView([-2.5, 118], 4);
    const place = () => {
      const ll = [+$("#b-lat").value, +$("#b-lon").value];
      if (pickMarker) { pickMarker.setLatLng(ll); pickCircle.setLatLng(ll); }
      else { pickMarker = L.circleMarker(ll, { radius: 7, color: "#fff", weight: 2, fillColor: css("--model-b"), fillOpacity: 1 }).addTo(mp); pickCircle = L.circle(ll, { radius: 100000, color: css("--model-b"), weight: 1.5, dashArray: "5 5", fillOpacity: 0.06 }).addTo(mp); }
    };
    place();
    mp.on("click", (ev) => { $("#b-lat").value = ev.latlng.lat.toFixed(2); $("#b-lon").value = ev.latlng.lng.toFixed(2); place(); runB(); });
    ["#b-lat", "#b-lon"].forEach((s) => $(s).addEventListener("change", place));
    $("#b-run").onclick = runB;
    $("#b-now").onclick = () => { $("#b-time").value = toInput(Date.now() / 1000); runB(); };

    $("#a-form").innerHTML = A_FIELDS.map((x) => {
      if (x[0] === "group") return `<div class="group">${x[1]}</div>`;
      if (x[0] === "time") return `<label>${x[1]}<input type="datetime-local" id="a-time" /></label>`;
      if (x[0] === "magType") return `<label>${x[1]}<select id="a-magType"><option value="mb">mb</option><option value="mww">mww</option><option value="lainnya">lainnya</option></select></label>`;
      return `<label>${x[1]}<input type="number" step="any" id="a-${x[0]}" /></label>`;
    }).join("");
    $("#a-reset").onclick = () => { fillAMedian(); $("#a-pick").value = ""; runA(); };
    $("#a-run").onclick = runA;
    $("#a-pick").onchange = () => { const e = S.usgs.find((x) => x.id === $("#a-pick").value); if (e) { fillA(e); runA(); } };
    fillAMedian();

    $("#csv-in").onchange = async (ev) => { const file = ev.target.files[0]; if (file) batch(parseCSV(await file.text()).map(usgsRow), file.name); };
    $("#csv-live").onclick = () => {
      if (S.usgsMode !== "live") { $("#csv-sum").innerHTML = `<span class="msg-warn">Data USGS terbaru sedang tidak bisa diakses. Silakan unggah file CSV.</span>`; return; }
      batch(S.usgs, "Data USGS 60 hari terakhir");
    };
    $("#csv-dl").onclick = downloadBatch;
  }
  function populateAPick() {
    const opts = S.usgs.filter((e) => e.meta).slice(0, 60);
    $("#a-pick").innerHTML = `<option value="">${opts.length ? "Pilih gempa…" : "Data USGS terbaru tidak tersedia"}</option>` +
      opts.map((e) => `<option value="${esc(e.id)}">M ${fmt(e.mag)} · ${esc(e.place)} · ${fmtDate(e.t)}</option>`).join("");
    if (opts.length) { $("#a-pick").value = opts[0].id; fillA(opts[0]); }
    runA();
  }
  function fillAMedian() {
    A_FIELDS.forEach((x) => { if (x[2] !== undefined) $("#a-" + x[0]).value = +S.A.median[x[2]].toFixed(4); });
    $("#a-time").value = toInput(Date.now() / 1000); $("#a-magType").value = "mb"; S.aActual = null;
  }
  function fillA(e) {
    A_KEYS.forEach((k) => ($("#a-" + k).value = e[k] ?? ""));
    $("#a-time").value = toInput(e.t);
    const mt = (e.magType || "").toLowerCase(); $("#a-magType").value = mt === "mb" || mt === "mww" ? mt : "lainnya";
    S.aActual = e.mag;
  }
  function runA() {
    const o = { t: fromInput($("#a-time").value) || Date.now() / 1000, magType: $("#a-magType").value };
    A_KEYS.forEach((k) => (o[k] = num($("#a-" + k).value)));
    const v = SM.predict(S.A, SM.rowA(o));
    const missing = ["gap", "dmin", "rms", "horizontalError", "depthError", "magError", "magNst"].filter((k) => o[k] === null);
    $("#a-out").innerHTML = resultHTML(v, interval("a", v), S.aActual, "a") +
      (S.aActual ? auditMsg(v, S.aActual) : `<p class="msg msg-muted">Belum ada magnitudo tercatat sebagai pembanding. Pilih gempa USGS di atas untuk mengaudit.</p>`) +
      (missing.length ? `<p class="msg msg-warn">Kolom kosong diisi nilai tengah data latih: ${missing.join(", ")}.</p>` : "") +
      (!inRegion(o.lat, o.lon) ? `<p class="msg msg-warn">Lokasi berada di luar wilayah data latih (11° LS–6° LU, 95°–141° BT).</p>` : "");
  }
  function runB() {
    const ev = { lat: +$("#b-lat").value, lon: +$("#b-lon").value, depth: +$("#b-depth").value, t: fromInput($("#b-time").value) || Date.now() / 1000 };
    if (![ev.lat, ev.lon, ev.depth, ev.t].every(Number.isFinite)) { $("#b-out").innerHTML = `<p class="msg msg-warn">Isi semua kolom dengan angka yang valid.</p>`; return; }
    const { v, h } = estB(ev);
    const coverEnd = S.usgsMode === "live" ? Date.now() / 1000 : S.catEnd;
    const note = ev.t > coverEnd + DAY ? `Data riwayat hanya tersedia sampai ${fmtDate(coverEnd)}, jadi hitungan gempa sekitar mungkin belum lengkap.`
      : ev.t < Date.UTC(2015, 1, 1) / 1000 ? "Waktu sebelum 2015; data riwayat tidak lengkap." : "";
    $("#b-out").innerHTML = resultHTML(v, interval("b", v), null, "b") +
      `<div class="facts-sm"><span>Gempa sekitar 7 hari: <b>${h.n_7h}</b></span><span>30 hari: <b>${h.n_30h}</b></span><span>Terbesar 30 hari: <b>${h.mag_maks_30h ? "M " + fmt(h.mag_maks_30h) : "–"}</b></span></div>` +
      (note ? `<p class="msg msg-warn">${note}</p>` : "") +
      (!inRegion(ev.lat, ev.lon) ? `<p class="msg msg-warn">Lokasi berada di luar wilayah data latih.</p>` : "") +
      `<p class="msg msg-muted">Akurasi Model B rendah (R² 0,02). Anggap hasilnya sebagai magnitudo yang umum di lokasi ini, bukan ramalan.</p>`;
  }

  let batchRows = [];
  function batch(rows, label) {
    rows = rows.filter((e) => e.type === "earthquake" && e.mag !== null && e.lat !== null && e.lon !== null && e.depth !== null);
    if (!rows.length) { $("#csv-sum").textContent = "Tidak ada baris gempa yang valid. Pastikan file memakai format CSV USGS (time, latitude, longitude, depth, mag, magType, gap, …)."; return; }
    batchRows = rows.map((e) => { const p = SM.predict(S.A, SM.rowA(e)); return { ...e, pred: p, res: p - e.mag }; });
    const n = batchRows.length, err = batchRows.map((r) => r.res);
    const mae = err.reduce((a, b) => a + Math.abs(b), 0) / n;
    const flagged = batchRows.filter((r) => Math.abs(r.res) > 0.3).length;
    $("#csv-sum").innerHTML = `<b>${esc(label)}</b>: ${fmtInt(n)} gempa diperiksa · rata-rata selisih <b>${fmt(mae, 2)}</b> · perlu ditinjau <b>${fmtInt(flagged)}</b> (${pct(flagged / n, 1)})`;
    $("#csv-tbl").innerHTML = `<thead><tr><th>Waktu</th><th>Lokasi</th><th class="num">Magnitudo</th><th class="num">Estimasi A</th><th class="num">Selisih</th><th>Status</th></tr></thead><tbody>` +
      batchRows.slice(0, 500).map((r) => { const bad = Math.abs(r.res) > 0.3; return `<tr><td>${fmtTime(r.t)}</td><td>${esc(r.place)}</td><td class="num">${fmt(r.mag)}</td><td class="num">${fmt(r.pred, 2)}</td><td class="num ${bad ? "neg" : "pos"}">${fmt(r.res, 2)}</td><td>${bad ? '<span class="badge badge-bad" style="margin:0">Tinjau</span>' : '<span class="badge badge-ok" style="margin:0">Wajar</span>'}</td></tr>`; }).join("") + "</tbody>";
    $("#csv-dl").disabled = false;
  }
  function downloadBatch() {
    const head = ["time", "latitude", "longitude", "depth", "mag", "magType", "place", "estimasi_model_A", "selisih", "status"];
    const lines = [head.join(",")].concat(batchRows.map((r) => [new Date(r.t * 1000).toISOString(), r.lat, r.lon, r.depth, r.mag, r.magType, `"${String(r.place).replace(/"/g, '""')}"`, r.pred.toFixed(3), r.res.toFixed(3), Math.abs(r.res) > 0.3 ? "tinjau" : "wajar"].join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = "audit_model_A.csv"; a.click();
  }

  /* ================= EVALUASI ================= */
  function renderEvaluasi() {
    const ev = S.ev, M = ev.metrics, cA = css("--model-a"), cB = css("--model-b"), cBase = css("--baseline");
    $("#eval-lead").textContent = `Hasil pengujian pada ${fmtInt(ev.n_test)} gempa terbaru (${fmtDate(Date.parse(ev.test_from) / 1000)} – ${fmtDate(Date.parse(ev.test_to) / 1000)}) yang tidak dipakai saat pelatihan.`;
    const row = (name, k, desc) => { const m = M[k]; return `<tr><td><b>${name}</b><div class="sub">${desc}</div></td><td class="num"><b>${fmt(m.R2, 3)}</b></td><td class="num">${fmt(m.RMSE, 3)}</td><td class="num">${fmt(m.MAE, 3)}</td><td class="num">${pct(m["acc_0.3"])}</td><td class="num">${k === "Baseline" ? "–" : "−" + fmt((1 - m.RMSE / M.Baseline.RMSE) * 100, 1) + "%"}</td></tr>`; };
    $("#tbl-summary").innerHTML = `<thead><tr><th>Model</th><th class="num">R²</th><th class="num">RMSE</th><th class="num">MAE</th><th class="num">Tepat ±0,3</th><th class="num">Kesalahan vs baseline</th></tr></thead><tbody>` +
      row("Model A", "Model A", "Hist Gradient Boosting · 17 fitur · audit katalog") +
      row("Model B", "Model B", "Random Forest · 7 fitur · realtime") +
      row("Baseline", "Baseline", "Selalu menebak rata-rata data latih") + "</tbody>";
    renderScatter($("#seg-scatter .on").dataset.v);
    const tols = ["0.1", "0.2", "0.3", "0.5"];
    chart("ch-tol", { type: "bar", data: { labels: tols.map((t) => "±" + t.replace(".", ",")), datasets: [
      { label: "Model A", data: tols.map((t) => M["Model A"]["acc_" + t] * 100), backgroundColor: cA, borderRadius: 3 },
      { label: "Model B", data: tols.map((t) => M["Model B"]["acc_" + t] * 100), backgroundColor: cB, borderRadius: 3 },
      { label: "Baseline", data: tols.map((t) => M.Baseline["acc_" + t] * 100), backgroundColor: cBase, borderRadius: 3 }] },
      options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw, 1)}%` } } }, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false } } } } });
    const R = ev.rolling;
    chart("ch-roll", { type: "line", data: { labels: R.tahun, datasets: [
      { label: "Model A", data: R.A, borderColor: cA, backgroundColor: cA, tension: 0.3 },
      { label: "Model B", data: R.B, borderColor: cB, backgroundColor: cB, tension: 0.3 },
      { label: "Baseline", data: R.Base, borderColor: cBase, backgroundColor: cBase, borderDash: [5, 4] }] },
      options: { plugins: { legend: { position: "bottom" } }, scales: { y: { min: -0.1, max: 1, title: { display: true, text: "R²" } }, x: { grid: { display: false } } } } });
    $("#tbl-bin").innerHTML = `<thead><tr><th>Magnitudo</th><th class="num">Jumlah</th><th class="num">Bias A</th><th class="num">Selisih A</th><th class="num">Bias B</th><th class="num">Selisih B</th></tr></thead><tbody>` +
      ev.perbin.map((b) => `<tr><td>${b.bin}</td><td class="num">${fmtInt(b.n)}</td><td class="num ${b.biasA < -0.1 ? "neg" : ""}">${fmt(b.biasA, 2)}</td><td class="num">${fmt(b.maeA, 2)}</td><td class="num ${b.biasB < -0.1 ? "neg" : ""}">${fmt(b.biasB, 2)}</td><td class="num">${fmt(b.maeB, 2)}</td></tr>`).join("") + "</tbody>";
    renderImp($("#seg-imp .on").dataset.v);
  }
  function renderScatter(k) {
    const s = S.ev.scatter, col = css(k === "a" ? "--model-a" : "--model-b"), line = css("--text-2");
    chart("ch-scatter", { type: "scatter", data: { datasets: [
      { label: "Gempa uji", data: s.y.map((y, i) => ({ x: y + (Math.random() - 0.5) * 0.05, y: s[k][i] })), backgroundColor: col + "66", pointRadius: 2.5 },
      { type: "line", label: "Prediksi sempurna", data: [{ x: 4.4, y: 4.4 }, { x: 8, y: 8 }], borderColor: line, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0 }] },
      options: { plugins: { legend: { position: "bottom" } }, scales: { x: { min: 4.4, max: 8, title: { display: true, text: "Magnitudo asli" } }, y: { min: 4.4, max: 8, title: { display: true, text: "Magnitudo prediksi" } } } } });
    $("#scatter-note").textContent = k === "a"
      ? "Titik-titik mengikuti garis diagonal, artinya prediksi Model A dekat dengan nilai asli. Pada gempa besar, titik berada di bawah garis (prediksi terlalu kecil)."
      : "Prediksi Model B menumpuk di sekitar M 4,7–5,1 berapa pun magnitudo aslinya. Lokasi dan riwayat saja tidak cukup untuk menebak magnitudo.";
  }
  function renderImp(k) {
    const im = S.ev.importance[k].slice(0, 8);
    chart("ch-imp", { type: "bar", data: { labels: im.map((d) => d.f), datasets: [{ label: "Pengaruh", data: im.map((d) => d.v), backgroundColor: css(k === "A" ? "--model-a" : "--model-b"), borderRadius: 3 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: "Kenaikan kesalahan bila fitur diacak" } }, y: { grid: { display: false } } } } });
  }

  /* ================= wiring ================= */
  const rendered = {};
  const TABS = ["monitor", "analisis", "prediksi", "evaluasi", "tentang"];
  function showTab(name) {
    if (!TABS.includes(name)) name = "monitor";
    $$(".nav a").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".page").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
    window.scrollTo({ top: 0 });
    setTimeout(() => {
      if (name === "analisis") { if (!rendered.analisis) { initAnalisis(); rendered.analisis = true; } S.maps.hist.invalidateSize(); }
      if (name === "prediksi") { if (!rendered.prediksi) { initPrediksi(); populateAPick(); runB(); rendered.prediksi = true; } S.maps.pick.invalidateSize(); }
      if (name === "evaluasi" && !rendered.evaluasi) { renderEvaluasi(); rendered.evaluasi = true; }
      if (name === "monitor") S.maps.live.invalidateSize();
    }, 20);
  }

  async function refreshLive(first) {
    $("#btn-refresh").disabled = true;
    await Promise.all([loadUSGS(), loadBMKG()]);
    HC = null; [...S.usgs, ...S.bmkg].forEach((e) => { delete e._b; delete e._a; });
    updateConn(); renderMonitor();
    if (S.selected) { const s = currentEvents().find((e) => e.id === S.selected.id); if (s) select(s); }
    if (rendered.prediksi && !first) populateAPick();
    $("#updated").textContent = "Diperbarui " + new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " " + tzName;
    $("#btn-refresh").disabled = false;
  }

  async function main() {
    chartDefaults();
    $$("[data-tab]").forEach((t) => t.addEventListener("click", (e) => { e.preventDefault(); history.replaceState(null, "", "#" + t.dataset.tab); showTab(t.dataset.tab); }));
    $("#btn-theme").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    $("#feed").innerHTML = `<div class="empty">Memuat data…</div>`;
    await loadStatic();
    const m = S.maps.live = baseMap("map-live");
    liveLayer = L.layerGroup().addTo(m); focusLayer = L.layerGroup().addTo(m);
    $$("#seg-source button").forEach((b) => b.addEventListener("click", () => { S.source = b.dataset.v; S.selected = null; $("#detail").hidden = true; focusLayer.clearLayers(); syncSeg(); renderMonitor(); }));
    $$("#seg-window button").forEach((b) => b.addEventListener("click", () => { S.windowDays = +b.dataset.v; syncSeg(); renderMonitor(); }));
    $$("#seg-scatter button").forEach((b) => b.addEventListener("click", () => { $$("#seg-scatter button").forEach((x) => x.classList.toggle("on", x === b)); renderScatter(b.dataset.v); }));
    $$("#seg-imp button").forEach((b) => b.addEventListener("click", () => { $$("#seg-imp button").forEach((x) => x.classList.toggle("on", x === b)); renderImp(b.dataset.v); }));
    $("#btn-refresh").onclick = () => refreshLive(false);
    await refreshLive(true);
    showTab(location.hash.slice(1));
    setInterval(() => { if (!document.hidden) refreshLive(false); }, 5 * 60 * 1000);
  }
  main().catch((e) => { console.error(e); $("main").insertAdjacentHTML("afterbegin", `<div class="alert">Gagal memuat aplikasi: ${esc(e.message)}</div>`); });
})();
