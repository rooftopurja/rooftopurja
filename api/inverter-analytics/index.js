// Inverter Analytics — fast & correct (PK + RowKey window + unit aware)
// npm i @azure/data-tables
const { TableClient } = require("@azure/data-tables");

// ----- connections -----
const DATA_CONN =
  process.env.TABLES_CONN_STRING ||
  process.env.STORAGE_CONN ||
  process.env.AzureWebJobsStorage;

const PLANT_DIR_CONN =
  process.env.PLANT_DIRECTORY_TABLE_CONN ||
  process.env.TABLES_CONN_STRING ||
  process.env.STORAGE_CONN ||
  process.env.AzureWebJobsStorage;

const PLANT_DIR_TABLE = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";

// List the Sungrow tables here (you can add more later – same schema family)
const SUNGROW_TABLES = (process.env.SVI_TABLES
  ? String(process.env.SVI_TABLES).split(",").map(s=>s.trim()).filter(Boolean)
  : ["SungrowInverter125KW","SungrowInverter100KW","SungrowInverter33KW","SungrowInverter20KW","SungrowInverter10KW"]
);

// ----- helpers -----
const pad = (n) => String(n).padStart(2, "0");
const toISTiso19 = (tsUtc) => {
  const ms = typeof tsUtc === "string" ? Date.parse(tsUtc) : tsUtc.getTime();
  const ist = new Date(ms + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 19);
};
const ymdFromUTCasIST = (d) => {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${ist.getUTCFullYear()}${pad(ist.getUTCMonth() + 1)}${pad(ist.getUTCDate())}`;
};
const rowkeyWindow = (start, end) => ({ rkStart: ymdFromUTCasIST(start), rkEnd: ymdFromUTCasIST(end) });
const filterForRK = (inv, rkStart, rkEnd) =>
  `PartitionKey eq '${inv}' and RowKey ge '${rkStart}' and RowKey lt '${rkEnd}'`;
const filterForPartition = (inv) => `PartitionKey eq '${inv}'`;

const pickNum = (o, names, dv = 0) => { for (const n of names) if (o[n] != null) return Number(o[n]); return dv; };
const unitToKWh = (val, unit) => {
  const u = String(unit || "").toUpperCase(); const v = Number(val) || 0;
  if (u === "WH")  return v / 1000;
  if (u === "KWH") return v;
  if (u === "MWH") return v * 1000;
  if (u === "GWH") return v * 1000 * 1000;
  return v;
};

function parseInverters(val) {
  const out = new Set();
  const feed = (x) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(feed);
    if (typeof x === "object") return Object.values(x).forEach(feed);
    if (typeof x !== "string") return;
    try { feed(JSON.parse(x)); return; } catch {}
    x.split(/[,;|\s]+/g).map(t=>t.trim()).filter(t=>/^Inverter_/i.test(t)).forEach(t=>out.add(t));
  };
  feed(val);
  return out;
}

async function resolveInvIdsFromPlants(plantIds) {
  if (!plantIds || !plantIds.length) return [];
  try {
    const client = TableClient.fromConnectionString(PLANT_DIR_CONN, PLANT_DIR_TABLE);
    const invSet = new Set();
    for await (const e of client.listEntities()) {
      const pid = String(e.Plant_ID ?? e.plant_id ?? e.PartitionKey ?? e.RowKey ?? "").trim();
      if (!plantIds.includes(pid)) continue;
      const invs = parseInverters(e.Inverters ?? e.inverters ?? e.Devices ?? e.devices ?? e.Inverter_ID);
      invs.forEach(v => invSet.add(v));
    }
    return [...invSet].sort();
  } catch {
    return []; // fail-soft
  }
}

function yieldWindowFor(view, date, dateFrom, dateTo) {
  const d0 = new Date(date + "T00:00:00Z");
  if (view === "week") {
    return { start: new Date(d0.getTime() - 6*86400000), end: new Date(d0.getTime() + 86400000) };
  }
  if (view === "month") {
    return { start: new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 5, 1)),
             end:   new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)) };
  }
  if (view === "year") {
    return { start: new Date(Date.UTC(d0.getUTCFullYear() - 4, 0, 1)),
             end:   new Date(Date.UTC(d0.getUTCFullYear() + 1, 0, 1)) };
  }
  if (view === "custom" && dateFrom && dateTo) {
    const start = new Date(dateFrom + "T00:00:00Z");
    const end   = new Date(new Date(dateTo + "T00:00:00Z").getTime() + 86400000);
    return { start, end };
  }
  // default day
  return { start: d0, end: new Date(d0.getTime() + 86400000) };
}

async function runLimited(items, limit, fn) {
  const out = [];
  let i = 0, running = 0;
  return new Promise((resolve)=> {
    const next = () => {
      if (i >= items.length && running === 0) return resolve(out);
      while (running < limit && i < items.length) {
        const idx = i++, it = items[idx]; running++;
        Promise.resolve(fn(it, idx))
          .then(v => out[idx]=v).catch(()=>out[idx]=null)
          .finally(()=>{ running--; next(); });
      }
    };
    next();
  });
}

// quick in-memory cache
const cache = new Map();
const CACHE_MS = 30000;

module.exports = async function (context, req) {
  const reply = (obj) => (context.res = { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: obj });

  if (!DATA_CONN) {
    return reply({ power:[], yield:[], cards:{TotalYield_MWh:0},
      meta:{ error:"no-connection-string", hint:"Set TABLES_CONN_STRING / STORAGE_CONN / AzureWebJobsStorage" } });
  }

  const date = req.query.date || new Date().toISOString().slice(0,10);
  const rawView = (req.query.view || "day").toLowerCase();
  const view = ["day","week","month","year","lifetime","custom"].includes(rawView) ? rawView : "day";
  const dateFrom = req.query.dateFrom, dateTo = req.query.dateTo;

  // preferred: invIds from UI; else plantIds -> resolve to invIds from PlantDirectory
  let invIds = (req.query.invIds || "").split(",").map(s=>s.trim()).filter(Boolean);
  if (!invIds.length) {
    const plantIds = (req.query.plantIds || "").split(",").map(s=>s.trim()).filter(Boolean);
    if (plantIds.length) invIds = await resolveInvIdsFromPlants(plantIds);
  }

  // If still nothing, we cannot compute a scoped view. Return empty.
  if (!invIds.length) {
    const { start, end } = yieldWindowFor(view, date, dateFrom, dateTo);
    return reply({ power:[], yield:[], cards:{TotalYield_MWh:0},
      meta:{ view, date, range:{start, end}, invIds, yieldUnit:"kWh", warn:"no-inverter-scope" }});
  }

  // cache key
  const ck = JSON.stringify({ view, date, dateFrom, dateTo, invIds, v:"rk2" });
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < CACHE_MS) return reply(hit.v);

  // time windows
  const dayStart = new Date(date + "T00:00:00Z");
  const dayEnd   = new Date(dayStart.getTime() + 86400000);
  const { start: yStart, end: yEnd } = yieldWindowFor(view, date, dateFrom, dateTo);

  // RowKey windows (IST-bucketed)
  const { rkStart: rkDayStart, rkEnd: rkDayEnd } = rowkeyWindow(dayStart, dayEnd);
  const { rkStart: rkYStart,   rkEnd: rkYEnd   } = rowkeyWindow(yStart, yEnd);

  // accumulators
  const powerMap = new Map();        // IST ISO -> {t, ac, dc}
  const maxDayByInv = new Map();     // inv|YYYY-MM-DD -> max Daily_Yield_KWH
  const maxMonthByInv = new Map();   // inv|YYYY-MM    -> max Monthly_Yield_KWH
  const maxTotalByInv = new Map();   // inv            -> max lifetime in MWh

  const bumpMax = (m, k, v) => { const cur = m.get(k) || 0; if (v > cur) m.set(k, v); };

  async function scanTable(tableName) {
    const client = TableClient.fromConnectionString(DATA_CONN, tableName);

    // Power (1-day RK window)
    await runLimited(invIds, 6, async (inv) => {
      for await (const row of client.listEntities({ queryOptions: { filter: filterForRK(inv, rkDayStart, rkDayEnd) } })) {
        const ts = row.Date_Time || row.Timestamp || row.DateTime || row.RowKey; if (!ts) continue;
        const iso = toISTiso19(new Date(ts));
        const ac  = pickNum(row, ["Total_AC_Power_KW","AC_Power_KW","AC_Power_kW"], 0);
        const dc  = pickNum(row, ["Total_DC_Power_KW","DC_Power_KW","DC_Power_kW"], 0);
        if (ac || dc) {
          const cur = powerMap.get(iso) || { t: iso, ac: 0, dc: 0 };
          cur.ac += ac; cur.dc += dc;
          powerMap.set(iso, cur);
        }
      }
    });

    // Yield window (for day/week/custom use Daily_Yield_KWH; for month/year prefer Monthly_Yield_KWH)
    if (view !== "lifetime") {
      await runLimited(invIds, 6, async (inv) => {
        for await (const row of client.listEntities({ queryOptions: { filter: filterForRK(inv, rkYStart, rkYEnd) } })) {
          const ts = row.Date_Time || row.Timestamp || row.DateTime || row.RowKey; if (!ts) continue;
          const iso = toISTiso19(new Date(ts));
          const d = iso.slice(0,10), m = iso.slice(0,7);
          const dy = pickNum(row, ["Daily_Yield_KWH","Daily_Yield_kWh"], null);
          if (dy != null) bumpMax(maxDayByInv, `${inv}|${d}`, dy);
          const mo = pickNum(row, ["Monthly_Yield_KWH","Monthly_Yield_kWh"], null);
          if (mo != null) bumpMax(maxMonthByInv, `${inv}|${m}`, mo);
        }
      });
    }

    // Lifetime — fast partition scan; use Total_Yield + Yield_Unit
    await runLimited(invIds, 6, async (inv) => {
      for await (const row of client.listEntities({ queryOptions: { filter: filterForPartition(inv) } })) {
        const ty = row.Total_Yield; const u = row.Yield_Unit;
        if (ty != null && u != null) {
          const mwh = unitToKWh(ty, u) / 1000;
          bumpMax(maxTotalByInv, inv, mwh);
        }
      }
    });
  }

  // hit all configured tables concurrently
  await Promise.all(SUNGROW_TABLES.map(scanTable));

  // Build yield series with correct unit logic
  let yieldArr = [];
  let yieldUnitForAxis = "kWh";   // axis label for chart
  if (view === "day") {
    const kwh = [...maxDayByInv.entries()]
      .filter(([k]) => k.split("|")[1] === date)
      .reduce((s, [,v]) => s + v, 0);
    if (kwh > 0) yieldArr = [{ d: date, val: kwh }];
    yieldUnitForAxis = "kWh";
  } else if (view === "week" || view === "custom") {
    const start = yStart.getTime(), end = yEnd.getTime();
    const dayMap = new Map();
    for (const [k, v] of maxDayByInv) {
      const d = k.split("|")[1]; const t = Date.parse(d + "T00:00:00Z");
      if (t >= start && t < end) dayMap.set(d, (dayMap.get(d) || 0) + v);
    }
    yieldArr = [...dayMap.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,val])=>({ d, val }));
    yieldUnitForAxis = "kWh";
  } else if (view === "month") {
    // prefer monthly buckets (already in kWh for most tables)
    const monthMap = new Map();
    if (maxMonthByInv.size) {
      for (const [k, v] of maxMonthByInv) {
        const m = k.split("|")[1];
        monthMap.set(m, (monthMap.get(m) || 0) + v);
      }
    } else {
      // fallback: sum daily into months
      for (const [k, v] of maxDayByInv) {
        const m = k.split("|")[1].slice(0,7);
        monthMap.set(m, (monthMap.get(m) || 0) + v);
      }
    }
    yieldArr = [...monthMap.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-6).map(([ym,val])=>({ ym, val }));
    yieldUnitForAxis = "kWh";
  } else if (view === "year") {
    // yearly sum: prefer monthly->year (kWh). We’ll display axis as MWh for readability.
    const byYear = new Map(), add=(y,v)=>byYear.set(y,(byYear.get(y)||0)+v);
    if (maxMonthByInv.size)  for (const [k,v] of maxMonthByInv) add(k.split("|")[1].slice(0,4), v);
    else                     for (const [k,v] of maxDayByInv)   add(k.split("|")[1].slice(0,4), v);
    // convert kWh -> MWh for display
    yieldArr = [...byYear.entries()]
      .sort((a,b)=>a[0].localeCompare(b[0]))
      .slice(-5)
      .map(([y, kwh]) => ({ y:Number(y), val: kwh/1000 }));
    yieldUnitForAxis = "MWh";
  } else if (view === "lifetime") {
    // lifetime = sum of inverter lifetime in MWh (already computed)
    const totalMWh = [...maxTotalByInv.values()].reduce((s,v)=>s+v,0);
    // For the bar, display in MWh up to 999, then GWh
    if (totalMWh >= 1000) {
      yieldArr = [{ title: "Lifetime", val: totalMWh/1000 }]; // GWh
      yieldUnitForAxis = "GWh";
    } else {
      yieldArr = [{ title: "Lifetime", val: totalMWh }]; // MWh
      yieldUnitForAxis = "MWh";
    }
  }

  const power = [...powerMap.values()].sort((a,b)=>a.t.localeCompare(b.t));
  const totalMWh = [...maxTotalByInv.values()].reduce((s,v)=>s+v,0);

  const out = {
    power,
    yield: yieldArr,
    cards: { TotalYield_MWh: Number(totalMWh.toFixed(2)) },
    meta: {
      serverTs: new Date().toISOString(),
      view, date,
      range: { start: yStart.toISOString(), end: yEnd.toISOString() },
      invIds,
      yieldUnit: yieldUnitForAxis,
      filter: "PartitionKey + RowKey"
    }
  };

  cache.set(ck, { t: Date.now(), v: out });
  reply(out);
};
