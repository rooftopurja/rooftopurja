"use strict";


/* -------------------------------------------------------
   CONFIG
------------------------------------------------------- */
const TABLE_NAME = process.env.METER_TABLES || "Premier300Meter";

/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */
function toKwh(value, unit) {
  const v = Number(value) || 0;
  const u = String(unit || "").toUpperCase();
  if (u === "GWH") return v * 1_000_000;
  if (u === "MWH") return v * 1_000;
  return v; // already kWh
}

function prevDate(d) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function sortByDate(a, b) {
  // expects r.Date = "YYYY-MM-DD"
  return String(a.Date || "").localeCompare(String(b.Date || ""));
}

function groupBy(rows, key) {
  const m = {};
  for (const r of rows) {
    const k = r[key];
    if (k == null) continue;
    if (!m[k]) m[k] = [];
    m[k].push(r);
  }
  return m;
}

function lastBeforeDate(rows, date) {
  const d = String(date);
  const filtered = rows.filter(r => String(r.Date) < d);
  if (!filtered.length) return 0;
  filtered.sort(sortByDate);
  return filtered[filtered.length - 1]._kwh;
}

function lastOnOrBefore(rows, date) {
  const d = String(date);
  const filtered = rows.filter(r => String(r.Date) <= d);
  if (!filtered.length) return 0;
  filtered.sort(sortByDate);
  return filtered[filtered.length - 1]._kwh;
}


function monthKeyFromQuery(qMonth, qYear) {
  // supports:
  // 1) month="YYYY-MM"
  // 2) month="MM" + year="YYYY"
  const m = String(qMonth || "").trim();
  const y = String(qYear || "").trim();
  if (/^\d{4}-\d{2}$/.test(m)) return m;
  if (/^\d{1,2}$/.test(m) && /^\d{4}$/.test(y)) {
    const mm = m.padStart(2, "0");
    return `${y}-${mm}`;
  }
  return "";
}

function findLastBefore(sortedRows, startDate) {
  // last row with Date < startDate (ISO compare safe)
  let out = null;
  for (const r of sortedRows) {
    const d = String(r.Date || "");
    if (!d) continue;
    if (d < startDate) out = r;
    else break; // sorted, so we can stop once we pass startDate
  }
  return out;
}

function findFirstInRange(sortedRows, startDate, endDateExclusive) {
  for (const r of sortedRows) {
    const d = String(r.Date || "");
    if (!d) continue;
    if (d >= startDate && d < endDateExclusive) return r;
    if (d >= endDateExclusive) return null;
  }
  return null;
}

function findLastInRange(sortedRows, startDate, endDateExclusive) {
  let out = null;
  for (const r of sortedRows) {
    const d = String(r.Date || "");
    if (!d) continue;
    if (d >= startDate && d < endDateExclusive) out = r;
    if (d >= endDateExclusive) break;
  }
  return out;
}

function endExclusiveForMonth(monthKey) {
  // monthKey = "YYYY-MM"
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  const dt = new Date(Date.UTC(y, m, 1)); // next month 1st (m is 1-based, JS month is 0-based; but here m is already next month index)
  return dt.toISOString().slice(0, 10);
}

function endExclusiveForYear(year) {
  const y = Number(year);
  const dt = new Date(Date.UTC(y + 1, 0, 1));
  return dt.toISOString().slice(0, 10);
}

/* =======================================================
   AZURE TABLE — SAS PAGINATION (SELF-CONTAINED)
======================================================= */
const https = require("https");
const { URL } = require("url");

async function queryTableAllSelf(tableName, filter = "") {
  const endpoint = process.env.AZURE_TABLE_ENDPOINT || process.env.TABLE_STORAGE_URL;
const sas =
  process.env.TABLE_SAS ||
  process.env.AZURE_TABLE_SAS ||
  process.env.TABLE_STORAGE_SAS;


  if (!endpoint || !sas) {
    throw new Error("Table SAS configuration missing");
  }

  let rows = [];
  let nextPK = "";
  let nextRK = "";

  do {
    const qs = [
      filter && `$filter=${encodeURIComponent(filter)}`,
      nextPK && `NextPartitionKey=${encodeURIComponent(nextPK)}`,
      nextRK && `NextRowKey=${encodeURIComponent(nextRK)}`
    ]
      .filter(Boolean)
      .join("&");

    const url = new URL(
      `${endpoint}/${tableName}?${qs}${qs ? "&" : ""}${sas}`
    );

    const data = await new Promise((resolve, reject) => {
  const req = https.request(
    {
      method: "GET",
      hostname: url.hostname,
      path: url.pathname + url.search,

      // 🔑 CRITICAL: FORCE JSON (PREVENT ATOM)
      headers: {
        Accept: "application/json;odata=nometadata",
        "Content-Type": "application/json",
        "x-ms-version": "2019-02-02"
      }
    },
    res => {
      let buf = "";
      res.on("data", d => (buf += d));
      res.on("end", () => {
        if (res.statusCode >= 300) {
          reject(new Error(buf));
          return;
        }
        resolve({
          body: JSON.parse(buf),
          headers: res.headers
        });
      });
    }
  );

  req.on("error", reject);
  req.end();
});


    rows.push(...(data.body.value || []));

    nextPK = data.headers["x-ms-continuation-nextpartitionkey"];
    nextRK = data.headers["x-ms-continuation-nextrowkey"];

  } while (nextPK && nextRK);

  return rows;
}

/* ---------------------------------------------
   LOAD PLANT DIRECTORY (TABLE STORAGE)
--------------------------------------------- */
async function loadPlantDirectory() {
  const plants = await queryTableAllSelf("PlantDirectory");
  return plants.map(p => ({
    Plant_ID: String(p.Plant_ID || p.PartitionKey),
    Plant_Name: p.Plant_Name || `Plant ${p.Plant_ID || p.PartitionKey}`
  }));
}

/* -------------------------------------------------------
   MAIN
------------------------------------------------------- */
module.exports = async function (context, req) {
  try {
    /* ---------------------------------------------
       INPUTS
    --------------------------------------------- */
    const period = (req.query.period || "lifetime").toLowerCase();
    const date   = req.query.date;   // YYYY-MM-DD
    const month  = req.query.month;  // "YYYY-MM" OR "MM"
    const year   = req.query.year;   // YYYY

    const monthKey = monthKeyFromQuery(month, year);

    const plantFilter = (req.query.plants || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
 

    /* ---------------------------------------------
       LOAD DATA (ALL ROWS, PAGINATED)
    --------------------------------------------- */
    const rows = await queryTableAllSelf(TABLE_NAME);

    if (!rows.length) {
      context.res = {
        status: 200,
        body: { success: true, kpi: {}, chart: [] }
      };
      return;
    }

    /* ---------------------------------------------
       NORMALIZE
    --------------------------------------------- */
    rows.forEach(r => {
      r._kwh = toKwh(r.Total_Yield, r.Yield_Unit);
      r.Date = (r.Date || "").slice(0, 10); // safety
    });

// 🔑 APPLY PLANT FILTER (IF PROVIDED)
const filteredRows =
  plantFilter.length
    ? rows.filter(r => plantFilter.includes(String(r.Plant_ID)))
    : rows;


/* ---------------------------------------------
   GROUP BY PLANT (REQUIRED)
--------------------------------------------- */
const byPlant = groupBy(filteredRows, "Plant_ID");
const plantDirectory = await loadPlantDirectory();

/* ---------------------------------------------
   PLANT LOOKUP MAP (Plant_ID → Plant_Name)
--------------------------------------------- */
const plantNameMap = {};
plantDirectory.forEach(p => {
  plantNameMap[String(p.Plant_ID)] = p.Plant_Name;
});

   /* ---------------------------------------------
   KPI CALCS (DYNAMIC-SAFE)
--------------------------------------------- */

// ---- LIFETIME
let lifetimeKwh = 0;
for (const pid in byPlant) {
  const rows = byPlant[pid].slice().sort(sortByDate);
  lifetimeKwh += rows[rows.length - 1]._kwh;
}

// ---- DATE
let dateKwh = 0;
if (period === "date" && date) {
  const prev = prevDate(date);
  for (const pid in byPlant) {
    const rows = byPlant[pid];
    const today = lastOnOrBefore(rows, date);
    const yesterday = lastOnOrBefore(rows, prev);
    if (today > yesterday) dateKwh += (today - yesterday);
  }
}

// ---- MONTH
let monthKwh = 0;

if (period === "month" && monthKey) {
  const monthStart = `${monthKey}-01`;
  const monthEndExclusive = endExclusiveForMonth(monthKey);

  for (const pid in byPlant) {
    const rows = byPlant[pid].slice().sort(sortByDate);

    const endRow  = findLastInRange(rows, monthStart, monthEndExclusive);
    const prevRow = findLastBefore(rows, monthStart);

    const endVal  = endRow?._kwh || 0;
    const prevVal = prevRow?._kwh || 0;

    if (endVal > prevVal) {
      monthKwh += (endVal - prevVal);
    }
  }
}


// ---- YEAR
let yearKwh = 0;
if (period === "year" && year) {
  const yearEnd = `${year}-12-31`;
  const yearStart = `${year}-01-01`;

  for (const pid in byPlant) {
    const rows = byPlant[pid];
    const endVal = lastOnOrBefore(rows, yearEnd);
    const startVal = lastBeforeDate(rows, yearStart);
    if (endVal > startVal) yearKwh += (endVal - startVal);
  }
}

   
/* ---------------------------------------------
   DAILY GENERATION (PLANT-SAFE, REALISTIC)
--------------------------------------------- */
const dailyMap = {};

for (const pid in byPlant) {
  const rows = byPlant[pid].slice().sort(sortByDate);

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];

    if (!prev.Date || !curr.Date) continue;
    if (curr.Date === prev.Date) continue;

    const delta = curr._kwh - prev._kwh;
    if (delta > 0 && delta < 20000) { // 🔑 sanity cap per plant/day
      dailyMap[curr.Date] = (dailyMap[curr.Date] || 0) + delta;

    }
  }
}

// LAST 90 DAYS
const chartSeries = Object.keys(dailyMap)
  .sort()
  .slice(-90)
  .map(d => {
  let total = 0;
  for (const pid in byPlant) {
    const rows = byPlant[pid];
    const match = rows.filter(x => x.Date <= d).sort(sortByDate);
if (match.length) {
  total += match[match.length - 1]._kwh;
}

  }
  return {
    date: d,
    daily_kwh: dailyMap[d], // incremental
    total_kwh: total        // cumulative
  };
});


/* ---------------------------------------------
   TABLE ROWS (PER PERIOD + PLANT FILTER)
--------------------------------------------- */
let tableRows = [];

if (period === "date" && date) {
  // Date → rows from that date + selected plants
  tableRows = filteredRows.filter(r => r.Date === date);
} else {
  // Other periods → ONE latest reading per PLANT
const latestByPlant = {};

filteredRows.forEach(r => {
  const pid = String(r.Plant_ID);
  if (
    !latestByPlant[pid] ||
    (r.Date_Time || "") > (latestByPlant[pid].Date_Time || "")
  ) {
    latestByPlant[pid] = r;
  }
});

tableRows = Object.values(latestByPlant);

}

/* ---------------------------------------------
   PIE DATA — LIFETIME CONTRIBUTION BY PLANT
--------------------------------------------- */
const pieData = [];

for (const pid in byPlant) {
  const rows = byPlant[pid].slice().sort(sortByDate);
  if (!rows.length) continue;

  const lifetimeVal = rows[rows.length - 1]._kwh;

  if (lifetimeVal > 0) {
    pieData.push({
      Plant_ID: pid,
      Plant_Name: plantNameMap[pid] || `Plant ${pid}`,
      Value: lifetimeVal
    });
  }
}

/* ---------------------------------------------
   RESPONSE  ✅ BACKEND AUTHORITATIVE
--------------------------------------------- */
context.res = {
  status: 200,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  body: {
    success: true,

    // ✅ PLANT FILTER
    plants: plantDirectory,

    // ✅ KPI
    kpi: {
      date_kwh: dateKwh,
      month_kwh: monthKwh,
      year_kwh: yearKwh,
      lifetime_kwh: lifetimeKwh
    },

    // ✅ BAR + LINE CHART
    chart: chartSeries,

    // ✅ PIE CHART
    pie: pieData,

    // ✅ TABLE (PER PERIOD RULE)
    latest_rows: tableRows.map(r => ({
      ...r,
      Plant_Name: plantNameMap[String(r.Plant_ID)] || `Plant ${r.Plant_ID}`
    }))
  }
};

  } catch (err) {
    context.log("❌ GetMeterData ERROR:", err);
    context.res = {
      status: 500,
      body: { success: false, error: err.message }
    };
  }
};
