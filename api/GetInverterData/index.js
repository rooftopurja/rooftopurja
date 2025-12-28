"use strict";

/* ============================================================================
   FINAL GetInverterData (REST ONLY • UNLIMITED PAGINATION • MEMORY CACHE)
   ----------------------------------------------------------------------------
   ✔ Reads InverterQueryCache  + InverterDailySummary (REST, no SDK)
   ✔ Uses SAME blob naming: Inverter_<ID>_<YYYY-MM-DD>.json
   ✔ Supports period = day, week, month, year, lifetime
   ✔ Supports offset for navigation
   ✔ Full REST pagination
   ✔ MEMORY CACHE:
        - cache resets only on cold start
        - auto-refresh interval = 60 seconds
   ============================================================================*/

const https = require("https");

/* ============================================================================
   ENV
   ============================================================================ */
const ACCOUNT = "solariothubstorage";
const TABLE_SAS = process.env.TABLE_SAS || process.env.TABLE_STORAGE_SAS;
const TABLE_ENDPOINT = `https://${ACCOUNT}.table.core.windows.net`;

const PLANT_TABLE = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
const CACHE_TABLE = "InverterQueryCache";
const SUMMARY_TABLE = "InverterDailySummary";

const BLOB_SAS_URL = process.env.BLOB_SAS_URL || "";
let CURVE_BASE = "";
let CURVE_SAS = "";
if (BLOB_SAS_URL) {
    const p = BLOB_SAS_URL.split("?");
    CURVE_BASE = p[0].replace(/\/+$/, "");
    CURVE_SAS = p[1] || "";
}

/* ============================================================================
   MEMORY CACHE (Option A)
   ============================================================================ */
const MEM = {
    timestamp: 0,
    plant: null,
    cache: null,
    summary: null,
};
// 🔥 Ultra-short response cache (DAY only)
const DAY_RESPONSE_CACHE = new Map();  // key → {res, ts}
const DAY_CACHE_TTL = 15000; // 15 seconds

const CACHE_TTL_MS = 60 * 1000; // refresh every 60 sec

/* ============================================================================
   LOW-LEVEL HTTPS HELPERS
   ============================================================================ */
function httpGET(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let body = "";
            res.on("data", d => body += d);
            res.on("end", () => {
                if (res.statusCode >= 400)
                    return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                try { resolve(JSON.parse(body)); }
                catch { reject(new Error("Invalid JSON")); }
            });
        }).on("error", reject);
    });
}

function tableGET(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { "Accept": "application/json;odata=nometadata" }
        }, res => {
            let body = "";
            res.on("data", d => body += d);
            res.on("end", () => {
                if (res.statusCode >= 400)
                    return reject(new Error(`GET FAILED ${res.statusCode}: ${body}`));
                const json = JSON.parse(body || "{}");
                resolve({
                    value: Array.isArray(json.value) ? json.value : [],
                    nextPK: res.headers["x-ms-continuation-nextpartitionkey"] || "",
                    nextRK: res.headers["x-ms-continuation-nextrowkey"] || ""
                });
            });
        }).on("error", reject);
    });
}

/* ============================================================================
   FULL REST PAGINATION
   ============================================================================ */
async function tableReadAll(tableName, filter) {
    let out = [];
    let nextPK = "", nextRK = "";

    do {
        let url = `${TABLE_ENDPOINT}/${tableName}()?${TABLE_SAS}&$top=1000`;
        url += "&$format=application/json;odata=nometadata";
        if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
        if (nextPK)
            url += `&NextPartitionKey=${encodeURIComponent(nextPK)}&NextRowKey=${encodeURIComponent(nextRK)}`;

        const r = await tableGET(url);
        out.push(...r.value);
        nextPK = r.nextPK;
        nextRK = r.nextRK;
    } while (nextPK);

    return out;
}

/* ============================================================================
   BLOB CURVE LOADING (same format as timers: Inverter_<ID>_<YYYY-MM-DD>.json)
   ============================================================================ */
async function loadCurveBlob(inv, dateStr) {
    if (!CURVE_BASE || !CURVE_SAS) return [];
    const invId = String(inv).replace(/^Inverter_/, "");
    const file = `Inverter_${invId}_${dateStr}.json`;
    const url = `${CURVE_BASE}/${file}?${CURVE_SAS}`;

    try {
        const data = await httpGET(url);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

/* ============================================================================
   DATE HELPERS
   ============================================================================ */
const fmtDate = d => new Date(d).toISOString().slice(0, 10);

function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}

function addMonths(d, n) {
    const x = new Date(d);
    x.setDate(15);
    x.setMonth(x.getMonth() + n);
    return x;
}

function pickLast(rows) {
    let best = null;
    for (const r of rows) {
        const t = String(r.Date_Time || r.DateTime || r.RowKey);
        if (!best || t > String(best.Date_Time || best.DateTime || best.RowKey))
            best = r;
    }
    return best;
}

/* ============================================================================
   AGGREGATION HELPERS
   ============================================================================ */
function filterInv(rows, invList) {
    const S = new Set(invList.map(String));
    return rows.filter(r => S.has(String(r.Inverter_ID)));
}

function sumDaily(rowsCache, rowsSummary, invList, date) {
    const S = new Set(invList.map(String));
    const c = rowsCache.filter(r => r.Date === date && S.has(String(r.Inverter_ID)));
    const s = rowsSummary.filter(r => r.Date === date && S.has(String(r.Inverter_ID)));
    const chosen = c.length ? c : s;
    return chosen.reduce((a, r) => a + Number(r.Daily_Yield_KWH || 0), 0);
}

function sumMonthly(rowsCache, rowsSummary, invList, prefix) {
    let total = 0;
    for (const inv of invList) {
        const invStr = String(inv);
        const c = rowsCache.filter(r => r.Inverter_ID === invStr && r.Date.startsWith(prefix));
        const s = rowsSummary.filter(r => r.Inverter_ID === invStr && r.Date.startsWith(prefix));
        const row = pickLast(c.length ? c : s);
        if (row) total += Number(row.Monthly_Yield_KWH || 0);
    }
    return total;
}

function sumYearly(rowsCache, rowsSummary, invList, yearStr) {
    let total = 0;
    for (const inv of invList) {
        const invStr = String(inv);
        const all = [...rowsCache, ...rowsSummary].filter(
            r => r.Inverter_ID === invStr && r.Date.startsWith(yearStr)
        );
        const last = pickLast(all);
        if (last) total += Number(last.Total_Yield_KWH || 0);
    }
    return total;
}

function lifetimeKPI(rowsCache, rowsSummary, invList) {
    let total = 0;
    for (const inv of invList) {
        const invStr = String(inv);
        const all = [...rowsCache, ...rowsSummary].filter(r => r.Inverter_ID === invStr);
        const last = pickLast(all);
        if (last) total += Number(last.Total_Yield_KWH || 0);
    }
    return total;
}

/* ============================================================================
   REFRESH MEMORY CACHE (every 60 sec)
   ============================================================================ */
async function refreshMemoryCache() {
    const now = Date.now();
    if (now - MEM.timestamp < CACHE_TTL_MS) return;

    const plant = await tableReadAll(PLANT_TABLE, "");
    const cache = await tableReadAll(CACHE_TABLE, "");
    const summary = await tableReadAll(SUMMARY_TABLE, "");

    MEM.plant = plant;
    MEM.cache = cache;
    MEM.summary = summary;
    MEM.timestamp = now;
}

/* ============================================================================
   🔒 RLS HELPERS (SELF-CONTAINED)
   ============================================================================ */
async function getAllowedPlants(email) {
    // ADMIN shortcut
    const prof = await tableReadAll(
        "UserProfile",
        `PartitionKey eq '${email}'`
    );

    if (prof.length && String(prof[0].Role).toLowerCase() === "admin") {
        return null; // ALL plants
    }

    // User-specific access
    const rows = await tableReadAll(
        "UserPlantAccess",
        `PartitionKey eq '${email}'`
    );

    return rows.map(r => String(r.Plant_ID));
}


/* ============================================================================
   MAIN FUNCTION
   ============================================================================ */
module.exports = async function (context, req) {
    try {

/* ============================================================================
   🔒 AUTH CONTEXT (MANDATORY)
   ============================================================================ */
const user = req.user;
const userEmail =
    user?.email ||
    user?.userDetails ||
    user?.claims?.email;

if (!userEmail) {
    context.res = {
        status: 401,
        body: { success: false, error: "Unauthorized" }
    };
    return;
}

      await refreshMemoryCache();

const allowedPlants = await getAllowedPlants(userEmail);

if (allowedPlants !== null && allowedPlants.length === 0) {
    context.res = {
        status: 403,
        body: { success: false, error: "No plant access assigned" }
    };
    return;
}


  

        const period = (req.query.period || "day").toLowerCase();
        const dateParam = req.query.date || fmtDate(new Date());
        const offset = parseInt(req.query.offset || "0");
        const plantSel = req.query.plants || "";
        const invSel = req.query.inverters || "";

        const plantDir = MEM.plant.map(p => ({
            Plant_ID: String(p.Plant_ID || p.PartitionKey),
            Inverters: String(p.Inverters || "")
                .split(",").map(x => x.trim()).filter(Boolean)
        }));

        /* ============================================================================
   🔒 EFFECTIVE PLANT FILTER (SERVER-SIDE)
   ============================================================================ */

// plants requested from UI (optional)
const requestedPlants = plantSel
    ? plantSel.split(",").map(String)
    : [];

// Admin → ALL
let effectivePlants = [];

if (allowedPlants === null) {
    effectivePlants = requestedPlants.length
        ? requestedPlants
        : plantDir.map(p => p.Plant_ID);
} else {
    effectivePlants = requestedPlants.length
        ? requestedPlants.filter(p => allowedPlants.includes(p))
        : allowedPlants;
}

// ❌ hard deny invalid access
if (requestedPlants.length && effectivePlants.length === 0) {
    context.res = {
        status: 403,
        body: { success: false, error: "Unauthorized plant access" }
    };
    return;
}


        let invList = [];

plantDir
    .filter(p => effectivePlants.includes(p.Plant_ID))
    .forEach(p => invList.push(...p.Inverters));

invList = [...new Set(invList)];

        if (invSel) {
            const filter = invSel.split(",").map(String);
            invList = invList.filter(x => filter.includes(x));
        }

/* ============================================================================
   🔥 PRE-WARM POWER CURVE CACHE (FIRST LOAD BOOST)
   ============================================================================ */
if (period === "day" && offset === 0 && invList.length) {
    const today = fmtDate(new Date());

    // fire-and-forget (DO NOT await)
    invList.forEach(inv => {
        loadCurveBlob(inv, today).catch(() => {});
    });
}



        const cache = filterInv(MEM.cache, invList);
        const summary = filterInv(MEM.summary, invList);

        const lifetime = lifetimeKPI(cache, summary, invList);

        const base = {
            success: true,
            period,
            date: dateParam,
            kpiValue: lifetime,
            kpiUnit: "kWh"
        };

        /* DAY */
       if (period === "day") {
    const effDate = fmtDate(addDays(dateParam, offset));

    // 🔑 CACHE KEY (date + inverter set)
    const cacheKey = userEmail + "|" + effDate + "|" + invList.join(",");

    const now = Date.now();
    const cached = DAY_RESPONSE_CACHE.get(cacheKey);

    if (cached && (now - cached.ts) < DAY_CACHE_TTL) {
        return context.res = cached.res;
    }

    const yieldVal = sumDaily(cache, summary, invList, effDate);

    // 🔥 PARALLEL curve load
    const curve = {};
    const blobs = await Promise.all(
        invList.map(inv => loadCurveBlob(inv, effDate))
    );

    blobs.forEach(rows => {
        rows.forEach(r => {
            if (!curve[r.Time]) curve[r.Time] = { Time: r.Time, AC: 0, DC: 0 };
            curve[r.Time].AC += Number(r.AC || 0);
            curve[r.Time].DC += Number(r.DC || 0);
        });
    });

    const response = {
        status: 200,
        body: {
            ...base,
            date: effDate,
            yieldSeries: [{ date: effDate, yield: yieldVal }],
            powerCurve: Object.values(curve)
                .sort((a, b) => a.Time.localeCompare(b.Time))
        }
    };

    // 🔑 store short cache
    DAY_RESPONSE_CACHE.set(cacheKey, { res: response, ts: now });

    return context.res = response;
}


        /* WEEK */
        if (period === "week") {
            const end = addDays(dateParam, offset * 7);
            const out = [];
            for (let i = 0; i < 7; i++) {
                const d = fmtDate(addDays(end, -i));
                out.push({ date: d, yield: sumDaily(cache, summary, invList, d) });
            }
            return context.res = { status: 200, body: { ...base, yieldSeries: out }};
        }

        /* MONTH */
        if (period === "month") {
            const end = addMonths(dateParam, offset * 6);
            const out = [];
            for (let i = 0; i < 6; i++) {
                const d = addMonths(end, -i);
                const pre = fmtDate(d).slice(0,7);
                out.push({ date: pre, yield: sumMonthly(cache, summary, invList, pre)});
            }
            return context.res = { status: 200, body: { ...base, yieldSeries: out }};
        }

        /* YEAR */
        if (period === "year") {
            const baseYear = parseInt(String(dateParam).slice(0,4));
            const endYear = baseYear + offset * 5;
            const out = [];
            for (let i = 0; i < 5; i++) {
                const y = String(endYear - i);
                out.push({ date: y, yield: sumYearly(cache, summary, invList, y) });
            }
            return context.res = { status: 200, body: { ...base, yieldSeries: out }};
        }

        /* LIFETIME */
        return context.res = {
            status: 200,
            body: {
                ...base,
                yieldSeries: [{ date: "Lifetime", yield: lifetime }],
                powerCurve: []
            }
        };

    } catch (err) {
        context.log("❌ GetInverterData ERROR:", err);
        context.res = { status: 500, body: { success: false, error: String(err) }};
    }
};