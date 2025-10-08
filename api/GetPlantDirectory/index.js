const { TableClient } = require("@azure/data-tables");

/**
 * Returns:
 * {
 *   success: true,
 *   data: [
 *     { Plant_ID: 1, Plant_Name: "ESIC_Kalaburagi_Hospital", Meters: ["Meter_11","Meter_12", ...] },
 *     ...
 *   ],
 *   count: N
 * }
 *
 * Reads Azure Table Storage table: PlantDirectory
 * Columns expected (based on your screenshot):
 *   PartitionKey = Plant_ID
 *   RowKey       = "summary"
 *   Plant_Name   = string
 *   Meters       = comma-separated meter ids ("Meter_11,Meter_12,...")
 */
module.exports = async function () {
  try {
    const conn = process.env.AzureWebJobsStorage || process.env.STORAGE_CONNECTION_STRING;
    if (!conn) {
      return {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: { success: false, error: "Missing AzureWebJobsStorage/STORAGE_CONNECTION_STRING" }
      };
    }

    const tableName = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
    const client = TableClient.fromConnectionString(conn, tableName);

    const out = [];
    for await (const ent of client.listEntities({ queryOptions: {} })) {
      // Plant_ID can be column or PartitionKey (your table uses PartitionKey=Plant_ID)
      const plantId = Number(ent.Plant_ID ?? ent.partitionKey ?? ent.PartitionKey);
      const name = String(ent.Plant_Name ?? "").trim();
      const metersCsv = String(ent.Meters ?? ent.meters ?? "").trim();
      const meters = metersCsv
        ? metersCsv.split(",").map(s => s.trim()).filter(Boolean)
        : [];

      if (plantId && name) {
        out.push({ Plant_ID: plantId, Plant_Name: name, Meters: meters });
      }
    }

    // sort by Plant_ID for stable UI
    out.sort((a,b)=> (a.Plant_ID||0) - (b.Plant_ID||0));

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, data: out, count: out.length }
    };
  } catch (err) {
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: String(err && err.message || err) }
    };
  }
};
