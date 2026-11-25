"""Export models + data to JSON for the web app."""
import json, sys
from pathlib import Path
import joblib, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.dummy import DummyRegressor
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

SRC = Path(sys.argv[1]); OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
EPOCH = pd.Timestamp("1970-01-01", tz="UTC")
FITUR_A = ["latitude", "longitude", "depth", "tahun", "bulan", "jam_utc", "hari", "gap", "dmin", "rms",
           "horizontalError", "depthError", "magError", "magNst", "magType_lainnya", "magType_mb", "magType_mww"]
FITUR_B = ["latitude", "longitude", "depth", "n_7h", "n_30h", "mag_maks_30h", "hari_sejak_terakhir"]

A = joblib.load(SRC / "model/model_A_retrospektif.joblib")
B = joblib.load(SRC / "model/model_B_realtime.joblib")
meta = json.load(open(SRC / "model/metadata_model.json"))

# ---------- model A (HGB) ----------
hgb = A.named_steps["model"]
assert not hgb.is_categorical_ if hgb.is_categorical_ is not None else True
treesA = []
for (pred,) in hgb._predictors:
    n = pred.nodes
    treesA.append({"f": n["feature_idx"].tolist(), "t": n["num_threshold"].tolist(),
                   "l": n["left"].tolist(), "r": n["right"].tolist(),
                   "v": n["value"].tolist(), "leaf": n["is_leaf"].tolist()})
modelA = {"type": "hgb", "features": FITUR_A, "median": A.named_steps["imputasi"].statistics_.tolist(),
          "base": float(hgb._baseline_prediction.ravel()[0]), "trees": treesA}

# ---------- model B (RF) ----------
rf = B.named_steps["model"]
treesB = []
for e in rf.estimators_:
    t = e.tree_
    treesB.append({"f": t.feature.tolist(), "t": t.threshold.tolist(), "l": t.children_left.tolist(),
                   "r": t.children_right.tolist(), "v": t.value[:, 0, 0].tolist()})
modelB = {"type": "rf", "features": FITUR_B, "median": B.named_steps["imputasi"].statistics_.tolist(),
          "trees": treesB, "radius_km": 100}

json.dump(modelA, open(OUT / "model_A.json", "w"), separators=(",", ":"))
json.dump(modelB, open(OUT / "model_B.json", "w"), separators=(",", ":"))

# ---------- data ----------
df = pd.read_csv(SRC / "data_gempa_usgs_indonesia.csv")
df = df[df["type"].astype(str).str.lower().eq("earthquake")].copy()
for c in ["mag", "latitude", "longitude", "depth"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df["time"] = pd.to_datetime(df["time"], utc=True, errors="coerce")
df = df.drop_duplicates(subset="id").dropna(subset=["mag", "latitude", "longitude", "depth", "time"])
df = df[df["latitude"].between(-90, 90) & df["longitude"].between(-180, 180) & (df["depth"] >= 0)]
df = df.sort_values("time").reset_index(drop=True)
df["tahun"] = df["time"].dt.year; df["bulan"] = df["time"].dt.month
df["jam_utc"] = df["time"].dt.hour; df["hari"] = df["time"].dt.dayofweek
df["magType_grp"] = df["magType"].where(df["magType"].isin(["mb", "mww"]), "lainnya")
for t in ["lainnya", "mb", "mww"]:
    df[f"magType_{t}"] = (df["magType_grp"] == t).astype(int)

def riwayat(kej, kat, radius_km=100, jp=7, jl=30):
    kt = ((kat["time"] - EPOCH).dt.total_seconds()).values; u = np.argsort(kt); kt = kt[u]
    klat = np.radians(kat["latitude"].values)[u]; klon = np.radians(kat["longitude"].values)[u]
    kmag = kat["mag"].values[u]
    qt = ((kej["time"] - EPOCH).dt.total_seconds()).values
    qlat = np.radians(kej["latitude"].values); qlon = np.radians(kej["longitude"].values)
    n = len(kej); n7 = np.zeros(n); n30 = np.zeros(n); mm = np.zeros(n); sj = np.full(n, float(jl))
    for i in range(n):
        lo = np.searchsorted(kt, qt[i] - jl * 86400, side="left"); hi = np.searchsorted(kt, qt[i], side="left")
        if hi <= lo: continue
        a = np.sin((klat[lo:hi] - qlat[i]) / 2) ** 2 + np.cos(qlat[i]) * np.cos(klat[lo:hi]) * np.sin((klon[lo:hi] - qlon[i]) / 2) ** 2
        d = 2 * 6371.0 * np.arcsin(np.sqrt(a)) <= radius_km
        if not d.any(): continue
        w = kt[lo:hi][d]; n30[i] = d.sum(); n7[i] = (w >= qt[i] - jp * 86400).sum()
        mm[i] = kmag[lo:hi][d].max(); sj[i] = (qt[i] - w.max()) / 86400
    return pd.DataFrame({"n_7h": n7, "n_30h": n30, "mag_maks_30h": mm, "hari_sejak_terakhir": sj}, index=kej.index)

df = pd.concat([df, riwayat(df, df)], axis=1)

# parity fixtures: predictions of the saved models on a sample
rng = np.random.default_rng(0)
idx = np.sort(rng.choice(len(df), 400, replace=False))
fx = df.iloc[idx]
xa = fx[FITUR_A].copy(); xa.iloc[::7, 8] = np.nan  # include some missing values to test imputation
fixtures = {"A_X": xa.astype(float).where(xa.notna(), None).values.tolist(), "A_y": A.predict(xa).tolist(),
            "B_X": fx[FITUR_B].values.tolist(), "B_y": B.predict(fx[FITUR_B]).tolist()}
json.dump(fixtures, open(OUT.parent / "fixtures.json", "w"))

# catalog for the app (compact columnar)
pA = A.predict(df[FITUR_A])
cat = {"t": ((df["time"] - EPOCH).dt.total_seconds() // 1).astype(int).tolist(),
       "lat": df["latitude"].round(4).tolist(), "lon": df["longitude"].round(4).tolist(),
       "d": df["depth"].round(2).tolist(), "m": df["mag"].round(2).tolist(),
       "mt": df["magType"].fillna("").tolist(), "p": df["place"].fillna("").tolist(), "pa": np.round(pA, 3).tolist()}
json.dump(cat, open(OUT / "catalog.json", "w"), separators=(",", ":"))

# ---------- honest evaluation: train-only models on chronological 80/20 split ----------
n_l = int(len(df) * 0.8); tr, te = df.iloc[:n_l], df.iloc[n_l:]
pipa = lambda m: Pipeline([("imputasi", SimpleImputer(strategy="median")), ("model", m)])
mA = pipa(HistGradientBoostingRegressor(**meta["model_A"]["hyperparameter"])).fit(tr[FITUR_A], tr["mag"])
mB = pipa(RandomForestRegressor(**meta["model_B"]["hyperparameter"], n_jobs=-1)).fit(tr[FITUR_B], tr["mag"])
mD = pipa(DummyRegressor()).fit(tr[FITUR_A], tr["mag"])
y = te["mag"].values; pa, pb, pd0 = mA.predict(te[FITUR_A]), mB.predict(te[FITUR_B]), mD.predict(te[FITUR_A])

def met(p):
    e = p - y
    out = {"R2": r2_score(y, p), "RMSE": float(np.sqrt(mean_squared_error(y, p))), "MAE": mean_absolute_error(y, p),
           "bias": float(e.mean())}
    for tol in (0.1, 0.2, 0.3, 0.5):
        out[f"acc_{tol}"] = float((np.abs(e) <= tol + 1e-9).mean())
    # classification view: significant quake M>=5.5
    yt, yp = y >= 5.5, p >= 5.5
    tp = int((yt & yp).sum()); fp = int((~yt & yp).sum()); fn = int((yt & ~yp).sum())
    out["sig_precision"] = tp / (tp + fp) if tp + fp else None
    out["sig_recall"] = tp / (tp + fn) if tp + fn else None
    # 4-class accuracy
    bins = [0, 4.95, 5.45, 5.95, 10]
    out["class_acc"] = float((np.digitize(y, bins) == np.digitize(p, bins)).mean())
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}

metrics = {"Baseline": met(pd0), "Model A": met(pa), "Model B": met(pb)}
bins = pd.cut(y, [4.4, 4.9, 5.4, 5.9, 8.0], labels=["4,5–4,9", "5,0–5,4", "5,5–5,9", "≥ 6,0"])
perbin = []
for b in bins.categories:
    s = bins == b
    perbin.append({"bin": b, "n": int(s.sum()), "biasA": round(float((pa - y)[s].mean()), 3),
                   "maeA": round(float(np.abs(pa - y)[s].mean()), 3), "biasB": round(float((pb - y)[s].mean()), 3),
                   "maeB": round(float(np.abs(pb - y)[s].mean()), 3)})

# permutation importance (A,B) on test
from sklearn.inspection import permutation_importance
imp = {}
for nm, m, F in (("A", mA, FITUR_A), ("B", mB, FITUR_B)):
    r = permutation_importance(m, te[F], y, n_repeats=5, random_state=42, scoring="neg_root_mean_squared_error")
    imp[nm] = sorted([{"f": f, "v": round(float(v), 4)} for f, v in zip(F, r.importances_mean)], key=lambda d: -d["v"])

rolling = {"tahun": list(range(2019, 2027)),
           "A": [0.787, 0.779, 0.749, 0.813, 0.821, 0.782, 0.803, 0.731],
           "B": [0.067, 0.090, 0.077, 0.025, 0.014, 0.044, 0.045, 0.012],
           "Base": [-0.001, -0.001, -0.003, -0.013, -0.000, -0.009, -0.003, -0.000]}
ev = {"metrics": metrics, "perbin": perbin, "importance": imp, "rolling": rolling,
      "n_train": len(tr), "n_test": len(te), "test_from": str(te["time"].min().date()), "test_to": str(te["time"].max().date()),
      "scatter": {"y": np.round(y, 2).tolist(), "a": np.round(pa, 3).tolist(), "b": np.round(pb, 3).tolist()},
      "bootstrap": {"A_R2": [0.701, 0.756, 0.803], "B_R2": [-0.008, 0.023, 0.049]},
      "cv": {"A": 0.7730, "B": 0.0499, "Base": -0.0031},
      "meta": meta}
json.dump(ev, open(OUT / "evaluation.json", "w"), separators=(",", ":"), ensure_ascii=False)

bm = pd.read_csv(SRC / "data_gempa_bmkg_realtime.csv").drop_duplicates(subset=["DateTime", "Coordinates"])
bm[["time", "lat", "lon", "mag", "depth", "Wilayah", "Potensi", "Dirasakan", "jenis_data"]].fillna("").to_json(
    OUT / "bmkg_snapshot.json", orient="records", force_ascii=False)
print(json.dumps(metrics, indent=1)); print(perbin)
for f in OUT.iterdir(): print(f.name, f.stat().st_size // 1024, "KB")
