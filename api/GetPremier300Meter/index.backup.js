const { TableClient } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");

module.exports = async function (context, req) {
  try {
    const accountUrl = process.env.STORAGE_ACCOUNT_URL;
    const tableName  = process.env.PREMIER_TABLE || "Premier300Meter";
    const plantId    = String(req.query.plantId ?? "").trim();
    const start      = String(req.query.start   ?? "").trim(); // YYYY-MM-DD
    const end        = String(req.query.end     ?? "").trim(); // YYYY-MM-DD
    const top        = Number(req.query.top ?? 500);

    if (!plantId) throw new Error("plantId is required (e.g. 12)");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw new Error("start/end must be YYYY-MM-DD");
    }

    // Build filter. Many rows store Plant_ID as string (PartitionKey) or column.
    const dayStart = `${start}T00:00:00Z`;
    const dayEnd   = `${end}T23:59:59Z`;

    // Use Timestamp window (works everywhere) and also allow Date column if present.
    // We do NOT use the broken "datetime'YYYY…'" literal anywhere.
    let filter = `(PartitionKey eq '${plantId}' or Plant_ID eq '${plantId}') and ` +
                 `((Timestamp ge datetime'${dayStart}' and Timestamp le datetime'${dayEnd}')` +
                 ` or (Date ge datetime'${dayStart}' and Date le datetime'${dayEnd}'))`;

    const cred   = new DefaultAzureCredential();
    const client = new TableClient(accountUrl, tableName, cred);

    const items = [];
    let count = 0;
    for await (const e of client.listEntities({ queryOptions: { filter } })) {
      items.push({
        Meter_ID: e.Meter_ID ?? e.Meter_Name ?? null,
        Meter_Make: e.Meter_Make ?? null,
        Meter_Model: e.Meter_Model ?? null,
        Meter_Serial_No: e.Meter_Serial_No ?? null,
        Total_Yield: Number(e.Total_Yield ?? 0),
        Yield_Unit: e.Yield_Unit ?? "kWh",
        Incremental_Daily_Yield_KWH: Number(e.Incremental_Daily_Yield_KWH ?? 0),
        Date_Time: e.Date_Time ?? e.Timestamp ?? null,
        Date: e.Date ?? (e.Date_Time ? String(e.Date_Time).slice(0,10) : null)
      });
      if (++count >= top) break;
    }

    // Sort ascending by Date_Time for consistency
    items.sort((a,b) => String(a.Date_Time ?? "").localeCompare(String(b.Date_Time ?? "")));

    context.res = { status: 200, body: { items } };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: { error: err.message } };
  }
};



