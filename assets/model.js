/* Seismo inference engine — runs the exported scikit-learn models in the browser.
 * Model A: HistGradientBoostingRegressor (17 fitur)  — baseline + sum(leaf values)
 * Model B: RandomForestRegressor (7 fitur)           — mean of tree outputs (input dicast ke float32 seperti sklearn)
 * Imputasi median identik dengan SimpleImputer(strategy="median").
 */
(function (root) {
  "use strict";
  const f32 = Math.fround;

  function impute(row, median) {
    const out = new Array(median.length);
    for (let i = 0; i < median.length; i++) {
      const v = row[i];
      out[i] = v === null || v === undefined || v === "" || Number.isNaN(+v) ? median[i] : +v;
    }
    return out;
  }

  function predictHGB(model, row) {
    const x = impute(row, model.median);
    let s = model.base;
    for (const t of model.trees) {
      let n = 0;
      while (!t.leaf[n]) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
      s += t.v[n];
    }
    return s;
  }

  function predictRF(model, row) {
    const x = impute(row, model.median).map(f32);
    let s = 0;
    for (const t of model.trees) {
      let n = 0;
      while (t.l[n] !== -1) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
      s += t.v[n];
    }
    return s / model.trees.length;
  }

  function predict(model, row) {
    return model.type === "hgb" ? predictHGB(model, row) : predictRF(model, row);
  }

  /* Haversine distance in km (R = 6371) */
  const RAD = Math.PI / 180;
  function haversine(lat1, lon1, lat2, lon2) {
    const a1 = lat1 * RAD, a2 = lat2 * RAD;
    const a = Math.sin((a2 - a1) / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
    return 2 * 6371.0 * Math.asin(Math.sqrt(a));
  }

  /* Fitur riwayat seismik — sama dengan riwayat_dari_katalog() di notebook.
   * catalog: array of {t (detik epoch), lat, lon, m}, boleh tidak terurut.
   * Hanya kejadian yang strictly lebih awal dari tSec. */
  function historyFeatures(ev, catalog, radiusKm = 100, short = 7, long = 30) {
    let n7 = 0, n30 = 0, mmax = 0, last = -Infinity;
    const lo = ev.t - long * 86400, s7 = ev.t - short * 86400;
    const near = [];
    for (const k of catalog) {
      if (k.t < lo || k.t >= ev.t) continue;
      const d = haversine(ev.lat, ev.lon, k.lat, k.lon);
      if (d > radiusKm) continue;
      n30++;
      if (k.t >= s7) n7++;
      if (k.m > mmax) mmax = k.m;
      if (k.t > last) last = k.t;
      near.push({ ...k, dist: d });
    }
    const since = n30 ? (ev.t - last) / 86400 : long;
    return { n_7h: n7, n_30h: n30, mag_maks_30h: mmax, hari_sejak_terakhir: since, near };
  }

  /* Komponen waktu untuk Model A (UTC). dayofweek pandas: Senin = 0 */
  function timeParts(tSec) {
    const d = new Date(tSec * 1000);
    return { tahun: d.getUTCFullYear(), bulan: d.getUTCMonth() + 1, jam_utc: d.getUTCHours(), hari: (d.getUTCDay() + 6) % 7 };
  }

  function rowA(o) {
    const tp = timeParts(o.t);
    const mt = (o.magType || "").toLowerCase();
    const g = mt === "mb" ? "mb" : mt === "mww" ? "mww" : "lainnya";
    return [o.lat, o.lon, o.depth, tp.tahun, tp.bulan, tp.jam_utc, tp.hari, o.gap, o.dmin, o.rms,
      o.horizontalError, o.depthError, o.magError, o.magNst, g === "lainnya" ? 1 : 0, g === "mb" ? 1 : 0, g === "mww" ? 1 : 0];
  }

  function rowB(o, h) {
    return [o.lat, o.lon, o.depth, h.n_7h, h.n_30h, h.mag_maks_30h, h.hari_sejak_terakhir];
  }

  const api = { predict, predictHGB, predictRF, haversine, historyFeatures, timeParts, rowA, rowB, impute };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SeismoModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
