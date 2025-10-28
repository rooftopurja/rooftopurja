/**
 * InverterDailySummaryTimer/index.cjs
 * Summarizes inverter data every 20 min — keeps today's summary and cache fresh.
 */

const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { DateTime } = require("luxon");

const CONN = process.env.TABLES_CONNECTION_STRING || process.env.AzureWebJobsStorage;
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
const SUMMARY_TABLE = "InverterDailySummary";
const CACHE_TABLE = "InverterQueryCache";
const CURVE_CONTAINER = process.env.CURVE_CONTAINER || "invertercurves";

/* ---------- helpers ---------- */

/** Load PlantDirectory */
async function loadPlantDirectory() {
  const client = TableClient.fromConnectionString(
    CONN,
    process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory"
  );
  const invToPlant = new Map();
  const plants = [];
  for await (const e of client.listEntities()) {
    const pid = Number(e.Plant_ID || e.PartitionKey);
    const invList = (e.Inverters || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    invList.forEach((inv) => invToPlant.set(inv, pid));
    plants.push({ Plant_ID: pid, Plant_Name: e.Plant_Name });
  }
  return { invToPlant, plants };
}

/** Normalize yield fields to kWh */
function toKWh(row, kwhField, genericField) {
  if (row[kwhField] !== undefined) return Number(row[kwhField]) || 0;
  if (row[genericField] !== undefined) {
    const val = Number(row[genericField]);
    const unit = String(row.Yield_Unit || "").toLowerCase();
    if (unit === "mwh") return val * 1000;
    if (unit === "gwh") return val * 1_000_000;
    return val;
  }
  return 0;
}

/** Compact curve for blob */
function buildCurves(rows, maxPoints = 200) {
  if (!rows.length) return [];
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, i) => i % step === 0).map((r) => ({
    Time: r.Date_Time || r.Timestamp,
    DC: Number(r.Total_DC_Power_KW || 0),
    AC: Number(r.Total_AC_Power_KW || 0),
  }));
}

/** Write JSON curve to blob */
async function writeCurve(blobSvc, inverterId, dateISO, data) {
  const container = blobSvc.getContainerClient(CURVE_CONTAINER);
  await container.createIfNotExists();
  const blobName = `${inverterId}_${dateISO}.json`;
  const blobClient = container.getBlockBlobClient(blobName);
  const payload = JSON.stringify(data);
  await blobClient.upload(payload, Buffer.byteLength(payload), {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
  return blobName;
}

/** Build filter for a single day */
function buildFilter(dayISO) {
  const start = DateTime.fromISO(dayISO, { zone: TIMEZONE }).startOf("day").toUTC();
  const end = start.plus({ days: 1 });
  return `Timestamp ge datetime'${start.toISO()}' and Timestamp lt datetime'${end.toISO()}'`;
}

/** Cache helper */
async function setCache(cacheClient, key, payload) {
  try {
    await cacheClient.upsertEntity({
      partitionKey: "cache",
      rowKey: key,
      Payload: JSON.stringify(payload),
      CachedUtc: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("Cache save failed:", err.message);
  }
}

/** Summarize rows for cache */
function summarizeForCache(rows, period, start, end) {
  const grouped = {};
  for (const r of rows) {
    const dateKey = r.Date || r.rowKey || r.Timestamp?.split("T")[0];
    if (!grouped[dateKey]) grouped[dateKey] = 0;
    grouped[dateKey] += Number(r.Daily_Yield_KWH || 0);
  }
  const yieldTrend = Object.entries(grouped)
    .map(([label, val]) => ({ label, valueKWh: val }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const totalKWh = yieldTrend.reduce((a, b) => a + b.valueKWh, 0);
  let yieldUnit = "kWh";
  let scaled = totalKWh;
  if (scaled >= 1_000_000) {
    scaled /= 1_000_000;
    yieldUnit = "GWh";
  } else if (scaled >= 1_000) {
    scaled /= 1_000;
    yieldUnit = "MWh";
  }

  return {
    powerCurve: [],
    yieldTrend,
    totalYield: scaled.toFixed(2),
    yieldUnit,
    window: { period, start: start.toISO(), end: end.toISO() },
  };
}

/* ---------- main ---------- */

module.exports = async function (context, myTimer) {
  try {
    const now = DateTime.now().setZone(TIMEZONE);
    const targetDate = now.toISODate(); // ✅ summarize current day
    context.log(`⏰ Timer triggered — summarizing ${targetDate}`);

    const summaryClient = TableClient.fromConnectionString(CONN, SUMMARY_TABLE);
    const blobSvc = BlobServiceClient.fromConnectionString(CONN);
    const cacheClient = TableClient.fromConnectionString(CONN, CACHE_TABLE);
    await cacheClient.createTable({ allowExisting: true });

    const { invToPlant, plants } = await loadPlantDirectory();
    const inverterTables = (process.env.INVERTER_TABLES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let upserts = 0;

    // --- Step 1: Update today's summaries ---
    for (const tableName of inverterTables) {
      const invClient = TableClient.fromConnectionString(CONN, tableName);
      const rows = [];
      // page fetch for scalability
      for await (const page of invClient.listEntities({ queryOptions: { filter: buildFilter(targetDate) } }).byPage({ maxPageSize: 500 })) {
        for (const e of page) rows.push(e);
      }
      if (!rows.length) continue;

      // group per inverter
      const byInv = new Map();
      for (const r of rows) {
        const inv = String(r.Inverter_ID || r.partitionKey || r.PartitionKey || "").trim();
        if (!inv) continue;
        if (!byInv.has(inv)) byInv.set(inv, []);
        byInv.get(inv).push(r);
      }

      // process each inverter group
      for (const [inv, list] of byInv) {
        const totalYield = Math.max(...list.map((r) => toKWh(r, "Total_Yield_KWH", "Total_Yield")));
        const dailyYield = Math.max(...list.map((r) => toKWh(r, "Daily_Yield_KWH", "Daily_Yield")));
        const monthlyYield = Math.max(...list.map((r) => toKWh(r, "Monthly_Yield_KWH", "Monthly_Yield")));
        const plantId = Number(invToPlant.get(inv) || 0);

        const curveData = buildCurves(list);
        const blobName = await writeCurve(blobSvc, inv, targetDate, curveData);

        const entity = {
          partitionKey: inv,
          rowKey: targetDate,
          Date: targetDate,
          Inverter_ID: inv,
          Plant_ID: plantId,
          Total_Yield_KWH: totalYield,
          Daily_Yield_KWH: dailyYield,
          Monthly_Yield_KWH: monthlyYield,
          Yield_Unit: "kWh",
          CurveBlob: blobName,
          LastRefreshedUtc: new Date().toISOString(),
        };

        try {
          await summaryClient.upsertEntity(entity, "Merge");
          upserts++;
        } catch (e) {
          context.log(`⚠️ Upsert failed for ${inv}: ${e.message}`);
        }
      }
    }

    context.log(`✅ ${upserts} inverter summaries updated`);

    // --- Step 2: Refresh cache (week + month aggregates) ---
    const startWeek = now.startOf("week");
    const endWeek = startWeek.plus({ weeks: 1 });
    const startMonth = now.startOf("month");
    const endMonth = startMonth.plus({ months: 1 });

    const allRows = [];
    for await (const e of summaryClient.listEntities()) allRows.push(e);

    for (const p of plants) {
      const pid = p.Plant_ID;
      const weekRows = allRows.filter(
        (r) =>
          Number(r.Plant_ID) === pid &&
          DateTime.fromISO(r.Date) >= startWeek &&
          DateTime.fromISO(r.Date) < endWeek
      );
      const monthRows = allRows.filter(
        (r) =>
          Number(r.Plant_ID) === pid &&
          DateTime.fromISO(r.Date) >= startMonth &&
          DateTime.fromISO(r.Date) < endMonth
      );

      const weekPayload = summarizeForCache(weekRows, "week", startWeek, endWeek);
      const monthPayload = summarizeForCache(monthRows, "month", startMonth, endMonth);

      await setCache(cacheClient, `week_0_${pid}_`, weekPayload);
      await setCache(cacheClient, `month_0_${pid}_`, monthPayload);
      context.log(`💾 Cache refreshed for Plant ${pid}`);
    }

    // --- Step 3: Aggregate All-Plants cache ---
    const allWeekRows = allRows.filter(
      (r) => DateTime.fromISO(r.Date) >= startWeek && DateTime.fromISO(r.Date) < endWeek
    );
    const allMonthRows = allRows.filter(
      (r) => DateTime.fromISO(r.Date) >= startMonth && DateTime.fromISO(r.Date) < endMonth
    );

    await setCache(cacheClient, `week_0_all_`, summarizeForCache(allWeekRows, "week", startWeek, endWeek));
    await setCache(cacheClient, `month_0_all_`, summarizeForCache(allMonthRows, "month", startMonth, endMonth));

    // --- Step 4: Cleanup old cache ---
    const cutoff = DateTime.utc().minus({ days: 7 });
    let deleted = 0;
    for await (const e of cacheClient.listEntities()) {
      const t = DateTime.fromISO(e.CachedUtc || e.Timestamp).toUTC();
      if (t < cutoff) {
        await cacheClient.deleteEntity(e.partitionKey, e.rowKey);
        deleted++;
      }
    }
    context.log(`🧹 Cache cleanup complete — removed ${deleted} old entries.`);
    context.log(`⚡ Summary + cache refresh complete`);
  } catch (err) {
    context.log.error("InverterDailySummaryTimer error:", err);
  }
};
