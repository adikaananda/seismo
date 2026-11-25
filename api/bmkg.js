// Vercel Serverless Function — proxy data terbuka BMKG (menghindari masalah CORS di browser).
// GET /api/bmkg?feed=autogempa|gempaterkini|gempadirasakan
const FEEDS = {
  autogempa: "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json",
  gempaterkini: "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json",
  gempadirasakan: "https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json",
};

module.exports = async (req, res) => {
  const feed = (req.query && req.query.feed) || "gempaterkini";
  const url = FEEDS[feed];
  if (!url) {
    res.status(400).json({ error: "feed tidak dikenal", allowed: Object.keys(FEEDS) });
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "seismo-id-prototype/1.0" } });
    clearTimeout(timer);
    if (!r.ok) throw new Error("BMKG HTTP " + r.status);
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
};
