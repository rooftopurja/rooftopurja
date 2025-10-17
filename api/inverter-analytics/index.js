import { listTablesWithPrefix, tableClient, queryRows } from "../shared/azure.js";

/**
 * GET /api/inverter-analytics
 * Query params:
 *   view=day|week|month|year|lifetime|custom
 *   date=YYYY-MM-DD (for "day" and power curve)
 *   start=YYYY-MM-DD  end=YYYY-MM-DD (for week/month/year/custom/lifetime windows)
 *   plantId=<id>  inverterId=<id>
 *
 * Returns:
 *  {
 *    kpi: { totalYield: number, unit: "MWH"|"GWH" },
 *    powerCurve: [{ t: "HH:mm", dc: number, ac: number }],   // always for "today" or date param
 *    yieldSeries: [{ label: "...", kwh: number }]            // day/week/month/year/custom/lifetime buckets
 *  }
 *
 * Robust to missing Plant_ID: will not filter by plant if only inverterId is present.
 */
export default async function (context, req) {
  try {
    const q = req.query || {};
    const view = (q.view || "day").toLowerCase();
    const dateStr = q.date || new Date().toISOString().slice(0,10);
    const start = q.start;
    const end   = q.end;
    const plantId = (q.plantId || "").trim();
    const inverterId = (q.inverterId || "").trim();

    // Discover inverter tables (or read explicit comma-list)
    const explicit = (process.env.INVERTER_TABLES || "").split(",").map(s=>s.trim()).filter(Boolean);
    const inverterTables = explicit.length ? explicit : await listTablesWithPrefix("SungrowInverter");

    // Helper: filter factory
    const dateOnly = (d)=> d.toISOString().slice(0,10);
    const buildFilter = (windowStart, windowEnd, wantDayOnly) => {
      const clauses = [];

      // Date range (use Date and/or Date_Time fields when present)
      if (windowStart && windowEnd) {
        clauses.push(`Timestamp ge datetime'${new Date(windowStart).toISOString()}' and Timestamp le datetime'${new Date(windowEnd).toISOString()}'`);
      }

      // Plant / Inverter filters (defensive to missing Plant_ID)
      if (plantId) {
        clauses.push(`Plant_ID eq '${plantId.replace(/'/g,"''")}'`);
      }
      if (inverterId) {
        clauses.push(`(PartitionKey eq '${inverterId.replace(/'/g,"''")}' or Inverter_ID eq '${inverterId.replace(/'/g,"''")}')`);
      }

      // For power curve day, many tables have a "Date" or "Date_Time" string field; we rely on Timestamp here
      if (wantDayOnly) {
        const start = new Date(dateStr + "T00:00:00Z");
        const end   = new Date(dateStr + "T23:59:59Z");
        clauses.push(`Timestamp ge datetime'${start.toISOString()}' and Timestamp le datetime'${end.toISOString()}'`);
      }

      return clauses.length ? clauses.join(" and ") : undefined;
    };

    // Compute the time window for yield series
    const now = new Date();
    const today = new Date(dateStr+"T00:00:00Z");
    let winStart = start ? new Date(start+"T00:00:00Z") : today;
    let winEnd   = end   ? new Date(end+"T23:59:59Z")   : today;

    if (!start && !end) {
      if (view === "day") { winStart=today; winEnd=new Date(today); winEnd.setUTCHours(23,59,59,999); }
      if (view === "week"){ winStart=new Date(today); winStart.setUTCDate(winStart.getUTCDate()-6); winEnd=today; }
      if (view === "month"){ winStart=new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); winEnd=today; }
      if (view === "year"){ winStart=new Date(Date.UTC(today.getUTCFullYear()-4, 0, 1)); winEnd=today; } // last 5 years
      if (view === "lifetime"){ winStart=new Date(Date.UTC(2000,0,1)); winEnd=today; }
    }

    // --- Pull data from all inverter tables (light paging) ---
    const MAX_PER_TABLE = 2000;
    const allRows = [];
    for (const t of inverterTables) {
      try {
        const cli = tableClient(t);
        const filter = buildFilter(winStart, winEnd, false);
        const rows = await queryRows(cli, filter, MAX_PER_TABLE);
        allRows.push(...rows);
      } catch (e) {
        context.log.warn(`Skip table ${t}: ${e?.message||e}`);
      }
    }

    // --- KPI total yield (sum of Total_Yield across selection) ---
    let totalYieldMWh = 0;
    for (const r of allRows) {
      let y = Number(r.Total_Yield ?? r.Total_Yield_MWH ?? 0);
      // If yield is stored in KWH with Yield_Unit 'KWH', convert
      const unit = (r.Yield_Unit || r.Total_Yield_Unit || "").toString().toUpperCase();
      if (!Number.isFinite(y)) y = 0;
      if (unit.includes("KWH")) y = y / 1000;
      totalYieldMWh += y;
    }
    const kpiUnit = totalYieldMWh >= 1000 ? "GWH" : "MWH";
    const kpiValue = kpiUnit === "GWH" ? (totalYieldMWh/1000) : totalYieldMWh;

    // --- Power Curve for the specified day (always shown) ---
    // Pull again but constrained to the chosen day to keep payload small
    const powerRows = [];
    for (const t of inverterTables) {
      try {
        const cli = tableClient(t);
        const filter = buildFilter(undefined, undefined, true);
        const pr = await queryRows(cli, filter, MAX_PER_TABLE);
        powerRows.push(...pr);
      } catch {}
    }
    // Map to 20-min buckets if your Lua already rounded; otherwise round here
    function key20(ts) {
      const d = new Date(ts);
      const m = Math.floor(d.getUTCMinutes()/20)*20;
      const k = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), m, 0));
      return k.toISOString();
    }
    const buckets = new Map();
    for (const r of powerRows) {
      const ts = r.Timestamp || r.Date_Time || r["Date_Time"];
      if (!ts) continue;
      const k = key20(ts);
      const dc = Number(r.Total_DC_Power_KW ?? r.DC_Power_KW ?? 0) || 0;
      const ac = Number(r.Total_AC_Power_KW ?? r.AC_Power_KW ?? 0) || 0;
      const cur = buckets.get(k) || { dc:0, ac:0 };
      cur.dc += dc; cur.ac += ac;
      buckets.set(k, cur);
    }
    const powerCurve = [...buckets.entries()]
      .sort((a,b)=> a[0].localeCompare(b[0]))
      .map(([iso, v]) => ({ t: iso.slice(11,16), dc: Number(v.dc.toFixed(2)), ac: Number(v.ac.toFixed(2)) }));

    // --- Yield series (build buckets based on view) ---
    const yieldBuckets = new Map(); // label -> kwh
    const add = (label, kwh)=> yieldBuckets.set(label, (yieldBuckets.get(label)||0)+kwh);

    function labelFor(r){
      const d = new Date(r.Timestamp);
      if (view === "day")   return d.toISOString().slice(0,10);                // YYYY-MM-DD
      if (view === "week")  return d.toISOString().slice(0,10);
      if (view === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
      if (view === "year")  return `${d.getUTCFullYear()}`;
      if (view === "lifetime") return "Lifetime";
      return d.toISOString().slice(0,10);
    }

    for (const r of allRows) {
      // Prefer Daily_Yield_KWH when available for day/week; Monthly_Yield_KWH for month; else derive from totals
      let kwh = 0;
      if (view === "month" && r.Monthly_Yield_KWH != null) {
        kwh = Number(r.Monthly_Yield_KWH) || 0;
      } else if (r.Daily_Yield_KWH != null) {
        kwh = Number(r.Daily_Yield_KWH) || 0;
      } else if (r.Total_Yield != null) {
        // fallback: can't derive delta without previous, so skip if we only have cumulative
        // (future improvement: compute diffs per inverter/date)
        kwh = 0;
      }
      add(labelFor(r), kwh);
    }

    const yieldSeries = [...yieldBuckets.entries()]
      .sort((a,b)=> a[0].localeCompare(b[0]))
      .map(([label, kwh]) => ({ label, kwh: Number(kwh.toFixed(2)) }));

    context.res = {
      status: 200,
      jsonBody: {
        kpi: { totalYield: Number(kpiValue.toFixed(3)), unit: kpiUnit },
        powerCurve,
        yieldSeries
      }
    };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, jsonBody: { error: String(err?.message || err) } };
  }
}
