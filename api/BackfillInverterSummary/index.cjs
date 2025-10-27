const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { DateTime } = require("luxon");

const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
const CONN = process.env.TABLES_CONNECTION_STRING || process.env.AzureWebJobsStorage;
const SUMMARY_TABLE = "InverterDailySummary";
const CURVE_CONTAINER = process.env.CURVE_CONTAINER || "invertercurves";

/** Returns inverter table list */
function getInverterTables() {
  return (process.env.INVERTER_TABLES || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

/** Loads PlantDirectory and builds inverter → plant map */
async function loadPlantDirectory(context) {
  const tableName =
    process.env.Plant_Directory_Table ||
    process.env.PLANT_DIRECTORY_TABLE ||
    "PlantDirectory";

  const client = TableClient.fromConnectionString(CONN, tableName);
  const invToPlant = new Map();

  for await (const e of client.listEntities()) {
    const pid = Number(e.Plant_ID || e.PartitionKey || 0);
    const invList = (e.Inverters || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);
    invList.forEach(inv => invToPlant.set(inv, pid));
  }

  context.log(`🔗 Loaded PlantDirectory → ${invToPlant.size} inverter links`);
  return invToPlant;
}

/** Partition-safe purge */
async function purgeSummaryTable(summaryClient, context) {
  context.log("🧹 Purging InverterDailySummary (partition-safe mode)...");
  const pkGroups = new Map();

  for await (const e of summaryClient.listEntities()) {
    if (!pkGroups.has(e.partitionKey)) pkGroups.set(e.partitionKey, []);
    pkGroups.get(e.partitionKey).push(e);
  }

  let deleted = 0;
  for (const [pk, rows] of pkGroups.entries()) {
    for (let i = 0; i < rows.length; i += 100) {
      const tx = rows
        .slice(i, i + 100)
        .map(r => ["delete", { partitionKey: pk, rowKey: r.rowKey }]);
      await summaryClient.submitTransaction(tx);
      deleted += tx.length;
    }
  }

  context.log(`✅ Purged ${deleted} entities`);
}

/** Builds Timestamp filter for Azure Table */
function buildTimestampFilter(dayISO) {
  const start = DateTime.fromISO(dayISO, { zone: TIMEZONE }).startOf("day").toUTC();
  const end = start.plus({ days: 1 });
  return `Timestamp ge datetime'${start.toISO()}' and Timestamp lt datetime'${end.toISO()}'`;
}

/** Reads inverter table rows for a given date */
async function readRowsForDay(tableName, dayISO) {
  const client = TableClient.fromConnectionString(CONN, tableName);
  const filter = buildTimestampFilter(dayISO);
  const rows = [];
  for await (const e of client.listEntities({ queryOptions: { filter } })) rows.push(e);
  rows.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
  return rows;
}

/** Compact downsample of curve */
function buildCurves(rows, maxPoints = 200) {
  const step = Math.ceil(rows.length / maxPoints);
  const subset = rows.filter((_, i) => i % step === 0);
  return subset.map(r => ({
    time: r.Date_Time || r.Timestamp,
    DC: Number(r.Total_DC_Power_KW || 0),
    AC: Number(r.Total_AC_Power_KW || 0)
  }));
}

/** Uploads curve to blob storage */
async function writeCurve(blobSvc, inverterId, dateISO, data) {
  const container = blobSvc.getContainerClient(CURVE_CONTAINER);
  await container.createIfNotExists();
  const blobName = `${inverterId}_${dateISO}.json`;
  const blobClient = container.getBlockBlobClient(blobName);
  const payload = JSON.stringify(data);
  await blobClient.upload(payload, Buffer.byteLength(payload), {
    blobHTTPHeaders: { blobContentType: "application/json" }
  });
  return blobName;
}

/** Normalizes any yield field to kWh */
function toKWh(row, kwhField, genericField) {
  // Prefer explicit KWH field
  if (row[kwhField] !== undefined && row[kwhField] !== null) {
    const v = Number(row[kwhField]);
    return Number.isFinite(v) ? v : 0;
  }

  // Fallback to generic + unit
  if (row[genericField] !== undefined && row[genericField] !== null) {
    const unit = String(row.Yield_Unit || row.Unit || "").toLowerCase();
    const val = Number(row[genericField]);
    if (!Number.isFinite(val)) return 0;
    if (unit === "mwh") return val * 1000;
    if (unit === "gwh") return val * 1_000_000;
    return val; // assume already kWh
  }
  return 0;
}

module.exports = async function (context, req) {
  try {
    const { purge, from, to } = req.body || {};
    const summaryClient = TableClient.fromConnectionString(CONN, SUMMARY_TABLE);
    const blobSvc = BlobServiceClient.fromConnectionString(CONN);
    const inverterTables = getInverterTables();

    if (!inverterTables.length) {
      context.res = { status: 400, body: "Missing INVERTER_TABLES in settings" };
      return;
    }

    if (purge) await purgeSummaryTable(summaryClient, context);

    const invToPlant = await loadPlantDirectory(context);

    const startDate = DateTime.fromISO(from || "2025-06-18", { zone: TIMEZONE });
    const endDate = DateTime.fromISO(
      to || DateTime.now().setZone(TIMEZONE).toISODate(),
      { zone: TIMEZONE }
    );

    let upserts = 0, skipped = 0;

    for (let d = startDate; d <= endDate; d = d.plus({ days: 1 })) {
      const dateISO = d.toISODate();
      context.log(`📅 Processing ${dateISO}`);

      for (const tableName of inverterTables) {
        const rows = await readRowsForDay(tableName, dateISO);
        if (!rows.length) continue;

        // group rows by inverter
        const byInv = new Map();
        for (const r of rows) {
          const inv = String(r.Inverter_ID || r.partitionKey || r.PartitionKey || "").trim();
          if (!inv) continue;
          if (!byInv.has(inv)) byInv.set(inv, []);
          byInv.get(inv).push(r);
        }

        for (const [inv, list] of byInv) {
          const totalYield = Math.max(...list.map(r => toKWh(r, "Total_Yield_KWH", "Total_Yield")));
          const dailyYield = Math.max(...list.map(r => toKWh(r, "Daily_Yield_KWH", "Daily_Yield")));
          const monthlyYield = Math.max(...list.map(r => toKWh(r, "Monthly_Yield_KWH", "Monthly_Yield")));

          const plantId = Number(invToPlant.get(inv) || 0);
          const curveBlob = await writeCurve(blobSvc, inv, dateISO, buildCurves(list));

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
            CurveBlob: curveBlob,
            LastRefreshedUtc: new Date().toISOString()
          };

          try {
            await summaryClient.upsertEntity(entity, "Merge");
            upserts++;
          } catch (e) {
            skipped++;
            context.log(`⚠️ ${inv} ${dateISO} failed: ${e.message}`);
          }
        }
      }
    }

    context.log(`✅ Backfill complete: ${upserts} upserts, ${skipped} skipped`);
    context.res = { status: 200, body: { upserts, skipped } };
  } catch (err) {
    context.log.error("BackfillInverterSummary error:", err);
    context.res = { status: 500, body: err.message };
  }
};
