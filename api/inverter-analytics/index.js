// Inverter Analytics — fast aggregation by PartitionKey + RowKey windows
// npm i @azure/data-tables
const { TableClient } = require("@azure/data-tables");

// ---- CONFIG (env with sensible defaults) -----------------------------------
const DATA_CONN =
  process.env.TABLES_CONN_STRING ||
  process.env.STORAGE_CONN ||
  process.env.AzureWebJobsStorage;

const SUNGROW_TABLES = (process.env.SVI_TABLES ||
  "SungrowInverter125KW,SungrowInverter100KW,SungrowInverter33KW,SungrowInverter20KW,SungrowInverter10KW")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// optional flexible field names (we still fall back safely)
let FIELD = { time: "Date_Time", ac: "Total_AC_Power_KW", dc: "Total_DC_Power_KW", yield: "Daily_Yield_KWH" };
try {
  if (process.env.SVI_FIELDS) FIELD = { ...FIELD, ...(JSON.parse(process.env.SVI_FIELDS) || {}) };
} catch {}

// ---- tiny helpers ----------------------------------------------------------
const pad = n => String(n).padStart(2, "0");
const pickNum = (o, names, dv = 0) => {
  for (const n of names) if (o[n] != null) return Number(o[n]);
  return dv;
};
const unitToKWh = (val, unit) => {
  const v = Number(val) || 0;
  const u = String(unit || "").toUpperCase();
  if (u === "WH") return v / 1000;
  if (u === "KWH") return v;
  if (u === "MWH") return v * 1000;
  if (u === "GWH") return v * 1000 * 1000;
  return v; // assume kWh
};
const istYMD = (dUTC) => {
  const ms = typeof dUTC === "string" ? Date.parse(dUTC) : dUTC.getTime();
  const ist = new Date(ms + 330 * 60 * 1000);
  return `${ist.getUTCFullYear()}${pad(ist.getUTCMonth() + 1)}${pad(ist.getUTCDate())}`;
};
const iso19IST = (dUTC) => {
  const ms = typeof dUTC === "string" ? Date.parse(dUTC) : dUTC.getTime();
  const ist = new Date(ms + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 19);
};

// RowKey window using IST day cuts
const rkWindow = (startUTC, endUTC) => ({ rkStart: istYMD(startUTC), rkEnd: istYMD(endUTC) });

// date range for views
function rangeFor(view, anchorISO, dateFrom, dateTo) {
  const a0 = new Date(anchorISO + "T00:00:00Z");
  if (view === "week") return { start: new Date(a0.getTime() - 6 * 86400000), end: new Date(a0.getTime() + 86400000) };
  if (view === "month") return {
    start: new Date(Date.UTC(a0.getUTCFullYear(), a0.getUTCMonth() - 5, 1)),
    end: new Date(Date.UTC(a0.getUTCFullYear(), a0.getUTCMonth() + 1, 1))
  };
  if (view === "year") return {
    start: new Date(Date.UTC(a0.getUTCFullYear() - 4, 0, 1)),
    end: new Date(Date.UTC(a0.getUTCFullYear() + 1, 0, 1))
  };
  if (view === "custom" && dateFrom && dateTo) {
    const s = new Date(dateFrom + "T00:00:00Z");
    const e = new Date(new Date(dateTo + "T00:00:00Z").getTime() + 86400000);
    return { start: s, end: e };
  }
  return { start: a0, end: new Date(a0.getTime() + 86400000) }; // day
}

const filterRK = (pk, a, b) => `PartitionKey eq '${pk}' and RowKey ge '${a}' and RowKey lt '${b}'`;
const filterPK = (pk) => `PartitionKey eq '${pk}'`;

async function runLimited(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0, running = 0;
  return await new Promise(resolve => {
    const kick = () => {
      while (running < limit && i < items.length) {
        const idx = i++, it = items[idx]; running++;
        Promise.resolve(fn(it, idx))
          .then(v => out[idx] = v)
          .catch(() => out[idx] = null)
          .finally(() => { running--; if (i >= items.length && running === 0) resolve(out); else kick(); });
      }
    };
    kick();
  });
}

// small cache (protects against click-spam)
const cache = new Map();
const CACHE_MS = 15000;

// ---- MAIN ------------------------------------------------------------------
module.exports = async function (context, req) {
  const reply = (status, body) => context.res = {
    status, headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
    }, body
  };
  if (req.method === "OPTIONS") return reply(204, null);

  if (!DATA_CONN) {
    return reply(200, { power: [], yield: [], cards: { TotalYield_MWh: 0 }, meta: { error: "no-conn" } });
  }

  const view = (req.query.view || "day").toLowerCase();
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const dateFrom = req.query.dateFrom, dateTo = req.query.dateTo;

  const invIds = String(req.query.invIds || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (invIds.length === 0) {
    return reply(200, { power: [], yield: [], cards: { TotalYield_MWh: 0 }, meta: { warn: "no-invIds", view, date } });
  }

  const ck = JSON.stringify({ v: 2, view, date, dateFrom, dateTo, invIds }); // v bumps when we change response shape
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < CACHE_MS) return reply(200, hit.val);

  // ranges
  const dayRange = rangeFor("day", date);
  const viewRange = rangeFor(view, date, dateFrom, dateTo);
  const { rkStart: rkDayStart, rkEnd: rkDayEnd } = rkWindow(dayRange.start, dayRange.end);
  const { rkStart: rkVStart, rkEnd: rkVEnd } = rkWindow(viewRange.start, viewRange.end);

  // working maps
  const powerByTs = new Map();            // iso19 -> {ac,dc}
  const maxDailyByInv = new Map();        // key inv|YYYY-MM-DD -> max kWh
  const maxMonthlyByInv = new Map();      // key inv|YYYY-MM   -> max kWh
  const lifetimeByInvMWh = new Map();     // inv -> mWh

  const bump = (map, key, val) => { if (val == null) return; const cur = map.get(key) || 0; if (val > cur) map.set(key, val); };

  async function scanTable(tabName) {
    const client = TableClient.fromConnectionString(DATA_CONN, tabName);

    // 1) power for the anchor day
    await runLimited(invIds, 6, async (pk) => {
      const it = client.listEntities({ queryOptions: { filter: filterRK(pk, rkDayStart, rkDayEnd) } });
      for await (const r of it) {
        const t = r[FIELD.time] || r.Timestamp || r.RowKey;
        if (!t) continue;
        const iso = iso19IST(new Date(t));
        const ac = pickNum(r, [FIELD.ac, "Total_AC_Power_KW"], 0);
        const dc = pickNum(r, [FIELD.dc, "Total_DC_Power_KW"], 0);
        if (ac || dc) {
          const cur = powerByTs.get(iso) || { ac: 0, dc: 0 };
          cur.ac += ac; cur.dc += dc;
          powerByTs.set(iso, cur);
        }
      }
    });

    // 2) daily/monthly yields inside the view window (prefer max-of-day/month snapshots)
    if (view !== "lifetime") {
      await runLimited(invIds, 6, async (pk) => {
        const it = client.listEntities({ queryOptions: { filter: filterRK(pk, rkVStart, rkVEnd) } });
        for await (const r of it) {
          const t = r[FIELD.time] || r.Timestamp || r.RowKey;
          if (!t) continue;
          const iso = iso19IST(new Date(t));
          const d = iso.slice(0, 10);
          const m = iso.slice(0, 7);
          const dy = pickNum(r, [FIELD.yield, "Daily_Yield_KWH"], null);
          if (dy != null) bump(maxDailyByInv, `${pk}|${d}`, dy);
          const mo = pickNum(r, ["Monthly_Yield_KWH"], null);
          if (mo != null) bump(maxMonthlyByInv, `${pk}|${m}`, mo);
        }
      });
    }

    // 3) lifetime (scan partition only; grab largest Total_Yield we see)
    await runLimited(invIds, 6, async (pk) => {
      const it = client.listEntities({ queryOptions: { filter: filterPK(pk) } });
      for await (const r of it) {
        const ty = r.Total_Yield; const uu = r.Yield_Unit;
        if (ty != null && uu != null) bump(lifetimeByInvMWh, pk, unitToKWh(ty, uu) / 1000);
      }
    });
  }

  await Promise.all(SUNGROW_TABLES.map(scanTable));

  // build yield arrays
  let yieldUnit = "kWh";
  let ySeries = [];

  if (view === "day") {
    // single bar (sum of daily totals of that date)
    const total = [...maxDailyByInv.entries()]
      .filter(([k]) => k.split("|")[1] === date)
      .reduce((s, [, v]) => s + v, 0);
    ySeries = total > 0 ? [{ d: date, val: total }] : [];
  } else if (view === "week" || view === "custom") {
    const s = viewRange.start.getTime(), e = viewRange.end.getTime();
    const byDay = new Map();
    for (const [k, v] of maxDailyByInv) {
      const d = k.split("|")[1];
      const ts = Date.parse(d + "T00:00:00Z");
      if (ts >= s && ts < e) byDay.set(d, (byDay.get(d) || 0) + v);
    }
    ySeries = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, val]) => ({ d, val }));
  } else if (view === "month") {
    const byMonth = new Map();
    if (maxMonthlyByInv.size) {
      for (const [k, v] of maxMonthlyByInv) {
        const m = k.split("|")[1];
        byMonth.set(m, (byMonth.get(m) || 0) + v);
      }
    } else {
      for (const [k, v] of maxDailyByInv) {
        const m = k.split("|")[1].slice(0, 7);
        byMonth.set(m, (byMonth.get(m) || 0) + v);
      }
    }
    ySeries = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([ym, val]) => ({ ym, val }));
  } else if (view === "year") {
    const byYear = new Map();
    const add = (y, v) => byYear.set(y, (byYear.get(y) || 0) + v);
    if (maxMonthlyByInv.size) {
      for (const [k, v] of maxMonthlyByInv) add(k.split("|")[1].slice(0, 4), v);
    } else {
      for (const [k, v] of maxDailyByInv) add(k.split("|")[1].slice(0, 4), v);
    }
    ySeries = [...byYear.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-5).map(([y, val]) => ({ y: Number(y), val }));
  } else if (view === "lifetime") {
    // sum across inverters; display unit always MWh (≥1000 -> GWh in frontend)
    const totalMWh = [...lifetimeByInvMWh.values()].reduce((s, v) => s + v, 0);
    yieldUnit = "MWh";
    ySeries = [{ title: "Lifetime", val: totalMWh }];
  }

  // power series
  const power = [...powerByTs.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, v]) => ({ t, ac: v.ac, dc: v.dc }));

  const totalMWh = [...lifetimeByInvMWh.values()].reduce((s, v) => s + v, 0);
  const payload = {
    power,
    yield: ySeries,
    cards: { TotalYield_MWh: Number(totalMWh.toFixed(2)) },
    meta: {
      server: new Date().toISOString(),
      view, date,
      range: { start: viewRange.start.toISOString(), end: viewRange.end.toISOString() },
      invIds, yieldUnit, tables: SUNGROW_TABLES
    }
  };

  cache.set(ck, { t: Date.now(), val: payload });
  return reply(200, payload);
};
