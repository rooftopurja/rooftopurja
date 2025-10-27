const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { DateTime } = require("luxon");

const CONN = process.env.TABLES_CONNECTION_STRING || process.env.AzureWebJobsStorage;
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
const SUMMARY_TABLE = "InverterDailySummary";
const CACHE_TABLE = "InverterQueryCache";
const CURVE_CONTAINER = process.env.CURVE_CONTAINER || "invertercurves";

/* ---------- Helpers ---------- */
async function loadPlantDirectory() {
  const client = TableClient.fromConnectionString(CONN, process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory");
  const invToPlant = new Map();
  const plants = [];
  for await (const e of client.listEntities()) {
    const pid = Number(e.Plant_ID || e.PartitionKey);
    const invs = (e.Inverters || "").split(",").map(x => x.trim()).filter(Boolean);
    invs.forEach(i => invToPlant.set(i, pid));
    plants.push({ Plant_ID: pid, Plant_Name: e.Plant_Name });
  }
  return { invToPlant, plants };
}

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

function buildCurves(rows, maxPoints = 200) {
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, i) => i % step === 0).map(r => ({
    Time: r.Date_Time || r.Timestamp,
    DC: Number(r.Total_DC_Power_KW || 0),
    AC: Number(r.Total_AC_Power_KW || 0)
  }));
}

async function writeCurveIfMissing(blobSvc, inverterId, dateISO, data) {
  const container = blobSvc.getContainerClient(CURVE_CONTAINER);
  await container.createIfNotExists();
  const blobName = `${inverterId}_${dateISO}.json`;
  const blobClient = container.getBlockBlobClient(blobName);

  // ✅ Skip upload if already exists
  const exists = await blobClient.exists();
  if (exists) return blobName;

  const payload = JSON.stringify(data);
  await blobClient.upload(payload, Buffer.byteLength(payload), {
    blobHTTPHeaders: { blobContentType: "application/json" }
  });
  return blobName;
}

function buildFilter(dayISO) {
  const start = DateTime.fromISO(dayISO, { zone: TIMEZONE }).startOf("day").toUTC();
  const end = start.plus({ days: 1 });
  return `Timestamp ge datetime'${start.toISO()}' and Timestamp lt datetime'${end.toISO()}'`;
}

async function setCache(cacheClient, key, payload) {
  try {
    await cacheClient.upsertEntity({
      partitionKey: "cache",
      rowKey: key,
      Payload: JSON.stringify(payload),
      CachedUtc: new Date().toISOString()
    });
  } catch (err) {
    console.warn("Cache save failed:", err.message);
  }
}

function summarizeForCache(rows, period, start, end) {
  const grouped = {};
  for (const r of rows) {
    const d = r.Date || r.rowKey || r.Timestamp?.split("T")[0];
    grouped[d] = (grouped[d] || 0) + Number(r.Daily_Yield_KWH || 0);
  }
  const trend = Object.entries(grouped)
    .map(([label, v]) => ({ label, valueKWh: v }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const total = trend.reduce((a, b) => a + b.valueKWh, 0);
  let unit = "kWh", scaled = total;
  if (scaled >= 1_000_000) { scaled /= 1_000_000; unit = "GWh"; }
  else if (scaled >= 1_000) { scaled /= 1_000; unit = "MWh"; }

  return {
    powerCurve: [],
    yieldTrend: trend,
    totalYield: scaled.toFixed(2),
    yieldUnit: unit,
    window: { period, start: start.toISO(), end: end.toISO() }
  };
}

/* ---------- MAIN FUNCTION ---------- */
module.exports = async function (context, myTimer) {
  try {
    const now = DateTime.now().setZone(TIMEZONE);
    const blobSvc = BlobServiceClient.fromConnectionString(CONN);
    const summaryClient = TableClient.fromConnectionString(CONN, SUMMARY_TABLE);
    const cacheClient = TableClient.fromConnectionString(CONN, CACHE_TABLE);
    await cacheClient.createTable({ allowExisting: true });

    const { invToPlant, plants } = await loadPlantDirectory();
    const inverterTables = (process.env.INVERTER_TABLES || "").split(",").map(s => s.trim()).filter(Boolean);

    // 🛡️ Catch-up safeguard → If last run missed yesterday, process it first
    const lastRunUtc = myTimer?.ScheduleStatus?.Last?.toISOString?.() || null;
    if (lastRunUtc) {
      const lastRun = DateTime.fromISO(lastRunUtc, { zone: "utc" }).setZone(TIMEZONE);
      const missedDays = now.startOf("day").diff(lastRun.startOf("day"), "days").days;
      if (missedDays >= 1 && missedDays <= 3) {
        for (let i = missedDays; i >= 1; i--) {
          const dateISO = now.minus({ days: i }).toISODate();
          context.log(`⏪ Catch-up run for missed date ${dateISO}`);
          await processDay(context, dateISO, summaryClient, blobSvc, invToPlant, inverterTables);
        }
      }
    }

    // 🕒 Regular run for current day
    const targetDate = now.toISODate();
    context.log(`🕒 20-minute summary refresh — ${targetDate}`);
    await processDay(context, targetDate, summaryClient, blobSvc, invToPlant, inverterTables);

    // 🔥 Warm cache & cleanup
    await warmAndCleanCache(context, summaryClient, cacheClient, plants, now);

    context.log("✅ InverterDailySummaryTimer cycle completed successfully.");
  } catch (err) {
    context.log.error("❌ InverterDailySummaryTimer error:", err);
  }
};

/* ---------- Core Day Processor ---------- */
async function processDay(context, dateISO, summaryClient, blobSvc, invToPlant, inverterTables) {
  let upserts = 0;
  for (const tableName of inverterTables) {
    const invClient = TableClient.fromConnectionString(CONN, tableName);
    const rows = [];
    for await (const e of invClient.listEntities({ queryOptions: { filter: buildFilter(dateISO) } })) rows.push(e);
    if (!rows.length) continue;

    const byInv = new Map();
    for (const r of rows) {
      const inv = String(r.Inverter_ID || r.PartitionKey || "").trim();
      if (!inv) continue;
      if (!byInv.has(inv)) byInv.set(inv, []);
      byInv.get(inv).push(r);
    }

    for (const [inv, list] of byInv) {
      const totalYield = Math.max(...list.map(r => toKWh(r, "Total_Yield_KWH", "Total_Yield")));
      const dailyYield = Math.max(...list.map(r => toKWh(r, "Daily_Yield_KWH", "Daily_Yield")));
      const monthlyYield = Math.max(...list.map(r => toKWh(r, "Monthly_Yield_KWH", "Monthly_Yield")));
      const plantId = Number(invToPlant.get(inv) || 0);
      const curveData = buildCurves(list);
      const blobName = await writeCurveIfMissing(blobSvc, inv, dateISO, curveData);

      const entity = {
        partitionKey: inv,
        rowKey: dateISO,
        Date: dateISO,
        Inverter_ID: inv,
        Plant_ID: plantId,
        Total_Yield_KWH: totalYield,
        Daily_Yield_KWH: dailyYield,
        Monthly_Yield_KWH: monthlyYield,
        Yield_Unit: "kWh",
        CurveBlob: blobName,
        LastRefreshedUtc: new Date().toISOString()
      };
      try {
        await summaryClient.upsertEntity(entity, "Merge");
        upserts++;
      } catch (e) {
        context.log(`⚠️ Upsert failed for ${inv}: ${e.message}`);
      }
    }
  }
  context.log(`✅ Summary aggregation complete for ${dateISO}: ${upserts} updates`);
}

/* ---------- Cache Warmer + Cleaner ---------- */
async function warmAndCleanCache(context, summaryClient, cacheClient, plants, now) {
  const startWeek = now.startOf("week"), endWeek = startWeek.plus({ weeks: 1 });
  const startMonth = now.startOf("month"), endMonth = startMonth.plus({ months: 1 });
  const allRows = [];
  for await (const e of summaryClient.listEntities()) allRows.push(e);

  for (const p of plants) {
    const pid = p.Plant_ID;
    const weekRows = allRows.filter(r => Number(r.Plant_ID) === pid &&
      DateTime.fromISO(r.Date) >= startWeek && DateTime.fromISO(r.Date) < endWeek);
    const monthRows = allRows.filter(r => Number(r.Plant_ID) === pid &&
      DateTime.fromISO(r.Date) >= startMonth && DateTime.fromISO(r.Date) < endMonth);
    await setCache(cacheClient, `week_0_${pid}_`, summarizeForCache(weekRows, "week", startWeek, endWeek));
    await setCache(cacheClient, `month_0_${pid}_`, summarizeForCache(monthRows, "month", startMonth, endMonth));
  }

  const allWeek = allRows.filter(r => DateTime.fromISO(r.Date) >= startWeek && DateTime.fromISO(r.Date) < endWeek);
  const allMonth = allRows.filter(r => DateTime.fromISO(r.Date) >= startMonth && DateTime.fromISO(r.Date) < endMonth);
  await setCache(cacheClient, `week_0_all_`, summarizeForCache(allWeek, "week", startWeek, endWeek));
  await setCache(cacheClient, `month_0_all_`, summarizeForCache(allMonth, "month", startMonth, endMonth));

  const cutoff = DateTime.utc().minus({ days: 7 });
  let deleted = 0;
  for await (const e of cacheClient.listEntities()) {
    const t = DateTime.fromISO(e.CachedUtc || e.Timestamp).toUTC();
    if (t < cutoff) {
      await cacheClient.deleteEntity(e.partitionKey, e.rowKey);
      deleted++;
    }
  }
  context.log(`🧹 Cache cleanup — removed ${deleted} old entries`);
}
