// Inverter Analytics — fast RK window + column projection
// npm i @azure/data-tables
const { TableClient } = require("@azure/data-tables");

const DATA_CONN =
  process.env.TABLES_CONN_STRING ||
  process.env.STORAGE_CONN ||
  process.env.AzureWebJobsStorage;

const SUNGROW_TABLES = (process.env.SVI_TABLES || "")
  .split(",").map(s=>s.trim()).filter(Boolean);
if (!SUNGROW_TABLES.length) {
  // fallback if env not set
  SUNGROW_TABLES.push("SungrowInverter125KW");
}

const SELECT_POWER = [
  "PartitionKey","RowKey","Date_Time",
  "Total_AC_Power_KW","Total_DC_Power_KW"
];
const SELECT_YIELD = [
  "PartitionKey","RowKey","Date_Time",
  "Daily_Yield_KWH","Monthly_Yield_KWH"
];
const SELECT_LIFE  = [
  "PartitionKey","Total_Yield","Yield_Unit"
];

const pickNum = (o, names, dv = 0) => { for (const n of names) if (o[n] != null) return Number(o[n]); return dv; };
const unitToKWh = (val, unit) => {
  const u = String(unit || "").toUpperCase(); const v = Number(val) || 0;
  if (u === "WH") return v / 1000; if (u === "KWH") return v; if (u === "MWH") return v * 1000; if (u === "GWH") return v * 1000 * 1000;
  return v;
};

const pad = (n) => String(n).padStart(2, "0");
const ymdIST = (d) => { const ist = new Date(d.getTime() + 330*60*1000);
  return `${ist.getUTCFullYear()}${pad(ist.getUTCMonth()+1)}${pad(ist.getUTCDate())}`; };
const rowkeyWindow = (start, end) => ({ rkStart: ymdIST(start), rkEnd: ymdIST(end) });
const toISTiso19 = (tsUtc) => { const ms = typeof tsUtc === "string" ? Date.parse(tsUtc) : tsUtc.getTime();
  return new Date(ms + 330*60*1000).toISOString().slice(0,19); };

function yieldWindowFor(view, date, dateFrom, dateTo) {
  const d0 = new Date(date + "T00:00:00Z");
  if (view === "week")  return { start: new Date(d0.getTime()-6*86400000), end:new Date(d0.getTime()+86400000) };
  if (view === "month") return { start:new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth()-5,1)),
                                 end:  new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth()+1,1)) };
  if (view === "year")  return { start:new Date(Date.UTC(d0.getUTCFullYear()-4,0,1)),
                                 end:  new Date(Date.UTC(d0.getUTCFullYear()+1,0,1)) };
  if (view === "custom" && dateFrom && dateTo) {
    const s = new Date(dateFrom + "T00:00:00Z");
    const e = new Date(new Date(dateTo + "T00:00:00Z").getTime()+86400000);
    return { start:s, end:e };
  }
  return { start:d0, end:new Date(d0.getTime()+86400000) };
}

const filterRK   = (inv, a, b) => `PartitionKey eq '${inv}' and RowKey ge '${a}' and RowKey lt '${b}'`;
const filterPart = (inv)        => `PartitionKey eq '${inv}'`;

async function runLimited(items, limit, fn) {
  const out = []; let i=0, running=0;
  return new Promise((resolve) => {
    const next = () => {
      if (i>=items.length && running===0) return resolve(out);
      while (running<limit && i<items.length) {
        const idx=i++, it=items[idx]; running++;
        Promise.resolve(fn(it, idx)).then(v=>out[idx]=v).catch(()=>out[idx]=null)
          .finally(()=>{ running--; next(); });
      }
    };
    next();
  });
}

const cache = new Map(); const CACHE_MS = 10000;

module.exports = async (context, req) => {
  const reply = (obj) => (context.res = { status:200, headers:{ "Content-Type":"application/json","Cache-Control":"no-store" }, body:obj });

  if (!DATA_CONN) return reply({ power:[], yield:[], cards:{TotalYield_MWh:0}, meta:{ error:"no-connection-string" } });

  const date = req.query.date || new Date().toISOString().slice(0,10);
  const view = ["day","week","month","year","lifetime","custom"].includes((req.query.view||"day").toLowerCase())
    ? (req.query.view||"day").toLowerCase() : "day";
  const dateFrom=req.query.dateFrom, dateTo=req.query.dateTo;

  const invIds = (req.query.invIds||"").split(",").map(s=>s.trim()).filter(Boolean);
  if (!invIds.length) return reply({ power:[], yield:[], cards:{TotalYield_MWh:0}, meta:{warn:"no-invIds"} });

  const ck = JSON.stringify({ view, date, dateFrom, dateTo, invIds, v:"rk+select" });
  const hit = cache.get(ck); if (hit && Date.now()-hit.t<CACHE_MS) return reply(hit.v);

  const dayStart = new Date(date+"T00:00:00Z"), dayEnd = new Date(dayStart.getTime()+86400000);
  const { start:yStart, end:yEnd } = yieldWindowFor(view, date, dateFrom, dateTo);
  const { rkStart:rkDayStart, rkEnd:rkDayEnd } = rowkeyWindow(dayStart, dayEnd);
  const { rkStart:rkYStart,   rkEnd:rkYEnd   } = rowkeyWindow(yStart, yEnd);

  const powerMap      = new Map();  // time -> {t, ac, dc}
  const maxDayByInv   = new Map();  // inv|YYYY-MM-DD -> max Daily_Yield_KWH
  const maxMonthByInv = new Map();  // inv|YYYY-MM    -> max Monthly_Yield_KWH
  const maxTotalByInv = new Map();  // inv            -> max lifetime (MWh)
  const bumpMax = (m,k,v)=>{ const cur=m.get(k)||0; if (v>cur) m.set(k,v); };

  async function scan(table) {
    const client = TableClient.fromConnectionString(DATA_CONN, table);

    // Power — per day
    await runLimited(invIds, 8, async (inv) => {
      const iter = client.listEntities({ queryOptions:{ filter: filterRK(inv, rkDayStart, rkDayEnd), select: SELECT_POWER } });
      for await (const row of iter) {
        const ts = row.Date_Time || row.RowKey || row.Timestamp; if (!ts) continue;
        const iso = toISTiso19(new Date(ts));
        const ac  = pickNum(row, ["Total_AC_Power_KW"], 0);
        const dc  = pickNum(row, ["Total_DC_Power_KW"], 0);
        if (ac || dc) {
          const cur = powerMap.get(iso) || { t: iso, ac: 0, dc: 0 };
          cur.ac += ac; cur.dc += dc; powerMap.set(iso, cur);
        }
      }
    });

    // Yield window
    if (view !== "lifetime") {
      await runLimited(invIds, 8, async (inv) => {
        const iter = client.listEntities({ queryOptions:{ filter: filterRK(inv, rkYStart, rkYEnd), select: SELECT_YIELD } });
        for await (const row of iter) {
          const ts = row.Date_Time || row.RowKey || row.Timestamp; if (!ts) continue;
          const iso = toISTiso19(new Date(ts));
          const d = iso.slice(0,10), m = iso.slice(0,7);
          const dy = pickNum(row, ["Daily_Yield_KWH"], null);
          if (dy != null) bumpMax(maxDayByInv, `${inv}|${d}`, dy);
          const mo = pickNum(row, ["Monthly_Yield_KWH"], null);
          if (mo != null) bumpMax(maxMonthByInv, `${inv}|${m}`, mo);
        }
      });
    }

    // Lifetime
    await runLimited(invIds, 8, async (inv) => {
      const iter = client.listEntities({ queryOptions:{ filter: filterPart(inv), select: SELECT_LIFE } });
      for await (const row of iter) {
        if (row.Total_Yield != null && row.Yield_Unit != null) {
          const mwh = unitToKWh(row.Total_Yield, row.Yield_Unit)/1000;
          bumpMax(maxTotalByInv, inv, mwh);
        }
      }
    });
  }

  await Promise.all(SUNGROW_TABLES.map(scan));

  // Yield series
  let yieldArr=[], yieldUnit="kWh";
  if (view === "day") {
    const kwh = [...maxDayByInv.entries()]
      .filter(([k])=>k.split("|")[1]===date)
      .reduce((s,[,v])=>s+v,0);
    if (kwh>0) yieldArr=[{ d:date, val:kwh }];
  } else if (view==="week" || view==="custom") {
    const s=yStart.getTime(), e=yEnd.getTime(); const dayMap=new Map();
    for (const [k,v] of maxDayByInv) { const d=k.split("|")[1]; const t=Date.parse(d+"T00:00:00Z");
      if (t>=s && t<e) dayMap.set(d,(dayMap.get(d)||0)+v); }
    yieldArr=[...dayMap.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,val])=>({ d,val }));
  } else if (view==="month") {
    const monthMap=new Map();
    if (maxMonthByInv.size) for (const [k,v] of maxMonthByInv) { const m=k.split("|")[1]; monthMap.set(m,(monthMap.get(m)||0)+v); }
    else for (const [k,v] of maxDayByInv) { const m=k.split("|")[1].slice(0,7); monthMap.set(m,(monthMap.get(m)||0)+v); }
    yieldArr=[...monthMap.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-6).map(([ym,val])=>({ ym,val }));
  } else if (view==="year") {
    const byYear=new Map(), add=(y,v)=>byYear.set(y,(byYear.get(y)||0)+v);
    if (maxMonthByInv.size) for (const [k,v] of maxMonthByInv) add(k.split("|")[1].slice(0,4), v);
    else for (const [k,v] of maxDayByInv) add(k.split("|")[1].slice(0,4), v);
    yieldArr=[...byYear.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-5).map(([y,val])=>({ y:Number(y), val }));
  } else if (view==="lifetime") {
    const totalMWh=[...maxTotalByInv.values()].reduce((s,v)=>s+v,0);
    let display=totalMWh*1000; yieldUnit="kWh";
    if (totalMWh>=1000) { display=(totalMWh/1000)*1000*1000; yieldUnit="GWh"; }
    else if (totalMWh>=1) { display=totalMWh*1000; yieldUnit="MWh"; }
    yieldArr=[{ title:"Lifetime", val:display }];
  }

  const power = [...powerMap.values()].sort((a,b)=>a.t.localeCompare(b.t));
  const totalMWh = [...maxTotalByInv.values()].reduce((s,v)=>s+v,0);

  const out = {
    power, yield:yieldArr,
    cards:{ TotalYield_MWh: Number(totalMWh.toFixed(2)) },
    meta:{ serverTs:new Date().toISOString(), view, date,
           range:{ start:yStart.toISOString(), end:yEnd.toISOString() },
           invIds, yieldUnit, filter:"PartitionKey+RowKey+select" }
  };
  cache.set(ck, { t:Date.now(), v:out });
  reply(out);
};
