// ===========================================================
//  GetInverterData/index.js
//  FINAL RECONSTRUCTED VERSION – SWA Node 18 Compatible
// ===========================================================

"use strict";

const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");

// Connection
const conn = process.env.AzureWebJobsStorage;
if (!conn) throw new Error("AzureWebJobsStorage missing.");

// Tables
const T_CACHE = "InverterQueryCache";
const T_SUMMARY = "InverterDailySummary";
const T_DIR = "PlantDirectory";
const T_RLS = "UserPlantAccess";

const BLOB_CONTAINER = "invertercurves";

// Shortcuts
const tc = (name) => TableClient.fromConnectionString(conn, name);
const bc = () =>
  BlobServiceClient.fromConnectionString(conn).getContainerClient(BLOB_CONTAINER);

const n = (v) => Number(v) || 0;
const iso = (d) => new Date(d).toISOString().slice(0, 10);

// =========================
//  UNIT NORMALISER
// =========================
function unit(v) {
  const abs = Math.abs(v);
  if (abs >= 1e12) return { v: v / 1e12, u: "TWh" };
  if (abs >= 1e9) return { v: v / 1e9, u: "GWh" };
  if (abs >= 1e6) return { v: v / 1e6, u: "MWh" };
  return { v, u: "kWh" };
}

// =========================
//  LOAD DIRECTORY
// =========================
async function loadDirectory() {
  const tbl = tc(T_DIR);
  const out = [];

  for await (const e of tbl.listEntities()) {
    out.push({
      Plant_ID: String(e.Plant_ID || e.PartitionKey || e.RowKey),
      Plant_Name: String(e.Plant_Name || ""),
      Inverters: String(e.Inverters || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    });
  }

  return out;
}

// =========================
//  LOAD RLS
// =========================
async function loadRLS(email) {
  const out = { isAdmin: false, allowed: [] };
  if (!email) return out;

  const admins = (process.env.GLOBAL_ADMINS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase());

  if (admins.includes(email.toLowerCase())) {
    out.isAdmin = true;
    return out;
  }

  const tbl = tc(T_RLS);
  for await (const r of tbl.listEntities({
    queryOptions: { filter: `PartitionKey eq '${email}'` },
  })) {
    out.allowed.push(String(r.Plant_ID));
  }

  return out;
}

// =========================
//  LOAD VISUAL SETTINGS
// =========================
async function loadVisual(email) {
  return {
    show_power_curve: true,
    show_yield_trend: true,
    show_kpi_yield: true,
  };
}

// =========================
//  READ POWER CURVE
// =========================
async function readCurve(blobName) {
  try {
    const cont = bc();
    const blob = cont.getBlockBlobClient(blobName);

    if (!(await blob.exists())) return [];

    const raw = (await blob.downloadToBuffer()).toString("utf8").trim();
    if (!raw) return [];

    let arr;
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = JSON.parse("[" + raw.replace(/}{/g, "},{") + "]");
    }

    return arr.map((p) => ({
      Time: p.Time || p.time || p.Date_Time,
      DC: n(p.DC || p.Power_DC || p.Total_DC_Power_KW),
      AC: n(p.AC || p.Power_AC || p.Total_AC_Power_KW || p.Power),
    }));
  } catch {
    return [];
  }
}

// =========================
//  FETCH ROWS BY DATE
// =========================
async function fetchRows(dateStr, plantSet, invSet) {
  const today = iso(new Date());
  const table = dateStr === today ? T_CACHE : T_SUMMARY;

  const tbl = tc(table);
  const out = [];

  for await (const e of tbl.listEntities({
    queryOptions: { filter: `Date eq '${dateStr}'` },
  })) {
    const p = String(e.Plant_ID);
    const i = String(e.Inverter_ID || e.PartitionKey);

    if (plantSet.size && !plantSet.has(p)) continue;
    if (invSet.size && !invSet.has(i)) continue;

    out.push(e);
  }

  return out;
}

// =========================
//  GET MONTH VALUE
// =========================
async function getMonthValue(monthKey, plantSet, invSet) {
  const [year, month] = monthKey.split("-");
  const isCurrent =
    year === String(new Date().getFullYear()) &&
    month === String(new Date().getMonth() + 1).padStart(2, "0");

  const tbl = tc(isCurrent ? T_CACHE : T_SUMMARY);
  const prefix = `${year}-${month}`;
  const map = new Map();

  for await (const r of tbl.listEntities()) {
    const ds = String(r.Date || "").slice(0, 10);
    if (!ds.startsWith(prefix)) continue;

    const p = String(r.Plant_ID);
    const i = String(r.Inverter_ID || r.PartitionKey);

    if (!plantSet.has(p)) continue;
    if (!invSet.has(i)) continue;

    const y = n(r.Monthly_Yield_KWH);
    map.set(i, y);
  }

  return [...map.values()].reduce((a, b) => a + b, 0);
}

// =========================
//  GET YEAR VALUE
// =========================
async function getYearValue(year, plantSet, invSet) {
  const isCurrent = String(year) === String(new Date().getFullYear());
  const tbl = tc(isCurrent ? T_CACHE : T_SUMMARY);

  const map = new Map();

  for await (const r of tbl.listEntities()) {
    const ds = String(r.Date || "").slice(0, 10);
    if (!ds.startsWith(String(year))) continue;

    const p = String(r.Plant_ID);
    const i = String(r.Inverter_ID || r.PartitionKey);

    if (!plantSet.has(p)) continue;
    if (!invSet.has(i)) continue;

    map.set(i, n(r.Total_Yield_KWH));
  }

  return [...map.values()].reduce((a, b) => a + b, 0);
}

// =========================
//  GET LIFETIME
// =========================
async function getLifetime(plantSet, invSet) {
  const map = new Map();

  const cache = tc(T_CACHE);
  for await (const r of cache.listEntities()) {
    const p = String(r.Plant_ID);
    const i = String(r.Inverter_ID || r.PartitionKey);
    if (!plantSet.has(p)) continue;
    if (!invSet.has(i)) continue;
    map.set(i, n(r.Total_Yield_KWH));
  }

  const summary = tc(T_SUMMARY);
  for await (const r of summary.listEntities()) {
    const p = String(r.Plant_ID);
    const i = String(r.Inverter_ID || r.PartitionKey);
    if (!plantSet.has(p)) continue;
    if (!invSet.has(i)) continue;
    if (!map.has(i)) map.set(i, n(r.Total_Yield_KWH));
  }

  return [...map.values()].reduce((a, b) => a + b, 0);
}

// ===========================================================
//  MAIN HANDLER
// ===========================================================
module.exports = async function (context, req) {
  try {
    const email = req.headers["x-ms-client-principal-email"] || "";
    const period = String(req.query.period || "day").toLowerCase();
    const date = iso(req.query.date || new Date());

    const rls = await loadRLS(email);
    const visual = await loadVisual(email);
    const dir = await loadDirectory();

    let allowed = rls.isAdmin || rls.allowed.length === 0
      ? new Set(dir.map((x) => x.Plant_ID))
      : new Set(rls.allowed);

    const qPlants = (req.query.plants || "").split(",").filter(Boolean);
    const plantSet = new Set(
      qPlants.length ? qPlants.filter((p) => allowed.has(p)) : [...allowed]
    );

    const invSet = new Set();
    dir.forEach((p) => {
      if (plantSet.has(p.Plant_ID))
        p.Inverters.forEach((i) => invSet.add(i));
    });

    let yieldSeries = [];
    let powerCurve = [];

    // DAY
    if (period === "day") {
      const rows = await fetchRows(date, plantSet, invSet);
      const y = rows.reduce((a, b) => a + n(b.Daily_Yield_KWH), 0);
      yieldSeries = [{ date, yield: y }];

      if (visual.show_power_curve) {
        const bucket = new Map();
        for (const r of rows) {
          const inv = String(r.Inverter_ID);
          const blob = (r.CurveBlob || `${inv}_${date}.json`).replace(/^invertercurves\//, "");
          const pts = await readCurve(blob);

          pts.forEach((p) => {
            const cur = bucket.get(p.Time) || { Time: p.Time, DC: 0, AC: 0 };
            cur.DC += p.DC;
            cur.AC += p.AC;
            bucket.set(p.Time, cur);
          });
        }

        powerCurve = [...bucket.values()].sort((a, b) => a.Time.localeCompare(b.Time));
      }
    }

    // WEEK
    else if (period === "week") {
      for (let k = 6; k >= 0; k--) {
        const d = new Date(date);
        d.setDate(d.getDate() - k);
        const ds = iso(d);
        const rows = await fetchRows(ds, plantSet, invSet);
        const y = rows.reduce((a, b) => a + n(b.Daily_Yield_KWH), 0);
        yieldSeries.push({ date: ds, yield: y });
      }
    }

    // MONTH
    else if (period === "month") {
      const base = new Date(date);
      const startYear = base.getUTCFullYear();
      const startMonth = base.getUTCMonth();

      for (let k = 5; k >= 0; k--) {
        const d = new Date(Date.UTC(startYear, startMonth - k, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        const y = await getMonthValue(key, plantSet, invSet);
        yieldSeries.push({ date: key, yield: y });
      }
    }

    // YEAR
    else if (period === "year") {
      const y0 = new Date(date).getUTCFullYear();
      for (let y = y0 - 4; y <= y0; y++) {
        const val = await getYearValue(y, plantSet, invSet);
        yieldSeries.push({ date: String(y), yield: val });
      }
    }

    // LIFETIME
    else if (period === "lifetime") {
      const val = await getLifetime(plantSet, invSet);
      yieldSeries = [{ date: "Lifetime", yield: val }];
    }

    // KPI
    const lifetimeVal = await getLifetime(plantSet, invSet);
    const kpi = unit(lifetimeVal);

    context.res = {
      status: 200,
      body: {
        success: true,
        date,
        period,
        show: visual,
        yieldSeries,
        powerCurve,
        kpiValue: Number(kpi.v.toFixed(2)),
        kpiUnit: kpi.u,
      },
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: { success: false, error: String(err) },
    };
  }
};