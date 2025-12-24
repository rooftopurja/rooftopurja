"use strict";

/*
   FINAL AccumulatorInit (Replacement Detection Engine)
   ----------------------------------------------------
   • HTTP trigger: /api/repair/accumulator
   • Reads ALL INVERTER_TABLES (raw inverter tables)
   • Groups by (Inverter_ID, Inverter_Serial_No)
   • Builds InverterAccumulator:
        - FirstSeenDate / LastSeenDate
        - Start / End / Lifetime yield (kWh)
        - IsActive flag (latest serial per inverter)
*/

const { queryTableAll } = require("../shared/rest");
const { insertOrReplace } = require("../shared/write");

const PLANT_TABLE      = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
const INVERTER_TABLES  = (process.env.INVERTER_TABLES || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const ACCUM_TABLE      = "InverterAccumulator";

/* ---------------------- Helpers ---------------------- */
function toKwh(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v)) return 0;

    const u = String(unit || "").toLowerCase();
    if (u.includes("twh")) return v * 1_000_000_000;
    if (u.includes("gwh")) return v * 1_000_000;
    if (u.includes("mwh")) return v * 1000;
    if (u.includes("kwh")) return v;
    if (u.includes("wh"))  return v * 0.001;
    return v;
}

function extractDateFields(row) {
    let dt = null;

    if (row.Date_Time) dt = row.Date_Time;
    else if (row.DateTime) dt = row.DateTime;
    else if (row.Timestamp) dt = row.Timestamp;

    if (typeof dt === "number") {
        dt = new Date(dt).toISOString();
    }

    if (!dt && row.RowKey) {
        const m = String(row.RowKey).match(/(\d{4})(\d{2})(\d{2})/);
        if (m) dt = `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;
    }

    if (!dt && row.Date) {
        dt = String(row.Date) + "T00:00:00Z";
    }

    if (!dt) {
        dt = new Date().toISOString();
    }

    row._DateTime = dt;
    row._Date     = dt.slice(0, 10);
}

/* ================================================================
   MAIN HANDLER
================================================================ */
module.exports = async function (context, req) {
    try {
        context.log("=== AccumulatorInit START ===");

        if (!INVERTER_TABLES.length) {
            context.log("No INVERTER_TABLES configured → nothing to do.");
            context.res = { status: 200, body: { success: true, rows: 0 } };
            return;
        }

        /* ---------------------- Plant Directory map ---------------------- */
        const plantRows = await queryTableAll(PLANT_TABLE, "");
        const plantMap  = {};

        for (const p of plantRows) {
            const plantId = String(p.Plant_ID || p.PartitionKey);
            const inverters = String(p.Inverters || "")
                .split(",")
                .map(x => x.trim())
                .filter(Boolean);

            for (const inv of inverters) {
                plantMap[inv] = plantId;
            }
        }

        /* ---------------------- Load all raw inverter rows ---------------------- */
        const promises = INVERTER_TABLES.map(tbl => queryTableAll(tbl, ""));
        const raw = (await Promise.all(promises)).flat();

        context.log(`Raw inverter rows loaded: ${raw.length}`);

        raw.forEach(extractDateFields);

        /* ---------------------- Group by (Inverter_ID, Serial) ---------------------- */
        const segMap = new Map(); // key = inv|serial → rows[]
        const invSegList = new Map(); // inv → [key]

        for (const r of raw) {
            const inv    = String(r.Inverter_ID || r.PartitionKey || "");
            const serial = String(r.Inverter_Serial_No || "").trim();
            if (!inv || !serial) continue;

            const key = `${inv}|${serial}`;
            if (!segMap.has(key)) segMap.set(key, []);
            segMap.get(key).push(r);

            if (!invSegList.has(inv)) invSegList.set(inv, []);
            if (!invSegList.get(inv).includes(key)) {
                invSegList.get(inv).push(key);
            }
        }

        context.log(`Unique inverter-serial segments: ${segMap.size}`);

        /* ---------------------- Build entities ---------------------- */
        const entities = new Map(); // key → entity

        for (const [key, rows] of segMap.entries()) {
            rows.sort((a, b) => a._DateTime.localeCompare(b._DateTime));
            const first = rows[0];
            const last  = rows[rows.length - 1];

            const [inv, serial] = key.split("|");

            const plantId = last.Plant_ID || plantMap[inv] || "";

            const startKwh = toKwh(
                first.Total_Yield ?? first.tpwryields ?? 0,
                first.Yield_Unit ?? "kWh"
            );
            const endKwh = toKwh(
                last.Total_Yield ?? last.tpwryields ?? 0,
                last.Yield_Unit ?? "kWh"
            );
            const lifetime = Math.max(0, endKwh - startKwh);

            const entity = {
                PartitionKey: inv,
                RowKey: serial,
                Inverter_ID: inv,
                Inverter_Serial_No: serial,
                Plant_ID: plantId,

                FirstSeenDate: first._Date,
                LastSeenDate:  last._Date,

                Start_Total_Yield_KWH: startKwh,
                End_Total_Yield_KWH:   endKwh,
                Lifetime_Yield_KWH:    lifetime,

                IsActive: false, // will set later
                Timestamp: new Date().toISOString()
            };

            entities.set(key, entity);
        }

        /* ---------------------- Mark active segments per inverter ---------------------- */
        for (const [inv, keys] of invSegList.entries()) {
            let bestKey = null;
            let bestDate = "";

            for (const key of keys) {
                const ent = entities.get(key);
                if (!ent) continue;
                if (!bestKey || String(ent.LastSeenDate) > bestDate) {
                    bestKey = key;
                    bestDate = String(ent.LastSeenDate);
                }
            }

            if (bestKey && entities.get(bestKey)) {
                entities.get(bestKey).IsActive = true;
            }
        }

        /* ---------------------- Write to InverterAccumulator ---------------------- */
        let written = 0;

        for (const [, ent] of entities.entries()) {
            await insertOrReplace(ACCUM_TABLE, ent);
            written++;
        }

        context.log(`✓ AccumulatorInit COMPLETE - ${written} accumulator rows written`);

        context.res = {
            status: 200,
            body: { success: true, rows: written }
        };
    } catch (err) {
        context.log("❌ ERROR in AccumulatorInit:", err);
        context.res = {
            status: 500,
            body: { success: false, error: String(err) }
        };
    }
};
