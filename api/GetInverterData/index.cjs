/**
 * GetInverterData - CommonJS version
 * Fetches summarized inverter data for Day/Week/Month/Year/Lifetime
 * with support for live-day refresh every 20 mins via cache+blob merge
 */

const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");

const AZ_CONN = process.env.TABLES_CONNECTION_STRING;
const STORAGE = process.env.AzureWebJobsStorage;
const CURVE_CONTAINER = process.env.CURVE_CONTAINER || "invertercurves";
const PLANT_DIR = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
const tz = process.env.APP_TIMEZONE || "Asia/Kolkata";

module.exports = async function (context, req) {
  try {
    context.log("Incoming parameters:", period, nav, plantIds, inverterIds);
    const period = (req.query.period || "day").toLowerCase();
    const nav = parseInt(req.query.nav || "0");
    const plantIds = (req.query.plants || "").split(",").filter(Boolean);
    const inverterIds = (req.query.inverters || "").split(",").filter(Boolean);

    const tableClient = TableClient.fromConnectionString(AZ_CONN, "InverterDailySummary");
    const blobService = BlobServiceClient.fromConnectionString(STORAGE);
    const containerClient = blobService.getContainerClient(CURVE_CONTAINER);

    // --- determine date range ---
    const today = new Date();
    const baseDate = new Date(today);
    baseDate.setDate(today.getDate() + nav);
    const dateKey = baseDate.toISOString().slice(0, 10);

    // --- prepare filters ---
    const plantFilter = plantIds.length ? plantIds.map(p => `PartitionKey eq '${p}'`).join(" or ") : "";
    const inverterFilter = inverterIds.length ? inverterIds.map(i => `RowKey eq '${i}'`).join(" or ") : "";
    const filter = [plantFilter, inverterFilter].filter(Boolean).join(" and ");

    // --- cache layer ---
    const cacheKey = `${period}:${dateKey}`;
    const summaryData = [];
    const powerPoints = [];

    // read inverter summary for KPI + yield
    for await (const entity of tableClient.listEntities({ queryOptions: { filter } })) {
      if (entity.DateKey && entity.DateKey.startsWith(dateKey)) summaryData.push(entity);
    }

    // --- compute cumulative yield ---
    const totalYield = summaryData.reduce((sum, e) => sum + (e.Total_Yield_kWh || e.Yield_kWh || 0), 0);

    // --- live-day: read latest blob JSONs and merge ---
    if (period === "day") {
      const blobNames = [];
      for await (const blob of containerClient.listBlobsFlat()) {
        if (blob.name.includes(dateKey) &&
          (!inverterIds.length || inverterIds.some(id => blob.name.includes(id)))) {
          blobNames.push(blob.name);
        }
      }

      // fetch blobs concurrently
      const parallel = blobNames.map(async name => {
        const blobClient = containerClient.getBlobClient(name);
        const res = await blobClient.download();
        const text = await streamToString(res.readableStreamBody);
        const arr = JSON.parse(text);
        arr.forEach(pt => powerPoints.push(pt));
      });
      await Promise.all(parallel);
    }

    // --- group by timestamp, sum instantaneous power across all inverters ---
    const timeMap = new Map();
    for (const p of powerPoints) {
      const t = p.Time || p.Timestamp || p.time;
      if (!t) continue;
      const key = new Date(t).toISOString();
      const existing = timeMap.get(key) || { Time: key, DC: 0, AC: 0 };
      existing.DC += Number(p.DC) || 0;
      existing.AC += Number(p.AC) || 0;
      timeMap.set(key, existing);
    }

    const powerCurve = Array.from(timeMap.values()).sort((a, b) => new Date(a.Time) - new Date(b.Time));

    // --- hourly grouping (auto skip 20-min points) ---
    const hourly = [];
    const hourSeen = new Set();
    for (const p of powerCurve) {
      const hr = new Date(p.Time).getHours();
      if (!hourSeen.has(hr)) {
        hourly.push(p);
        hourSeen.add(hr);
      }
    }

    // --- yield trend per period ---
    const yieldSeries = [];
    if (period === "day") {
      yieldSeries.push({ date: dateKey, yield: totalYield });
    } else {
      const group = {};
      for (const e of summaryData) {
        const key = e.DateKey || e.PartitionKey || dateKey;
        group[key] = (group[key] || 0) + (e.Total_Yield_kWh || e.Yield_kWh || 0);
      }
      for (const [d, val] of Object.entries(group)) yieldSeries.push({ date: d, yield: val });
    }

    return {
      status: 200,
      body: {
        success: true,
        period,
        totalYield,
        powerCurve: hourly,
        yieldSeries
      }
    };
  } catch (err) {
    context.log("GetInverterData error:", err);
    return { status: 500, body: { success: false, message: err.message } };
  }
};

// helper
async function streamToString(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on("data", d => chunks.push(d.toString()));
    readable.on("end", () => resolve(chunks.join("")));
    readable.on("error", reject);
  });
}
