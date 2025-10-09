const { TableClient } = require("@azure/data-tables");

// Helpful: stringify safely
function j(x){ try { return JSON.stringify(x) } catch { return String(x) } }

/**
 * Reads Azure Table Storage table: PlantDirectory
 * Expected columns (from your screenshot):
 *   PartitionKey = Plant_ID
 *   RowKey       = "summary"
 *   Plant_Name   = string
 *   Meters       = comma-separated ("Meter_11,Meter_12,...")
 *
 * Returns: { success, data:[{Plant_ID,Plant_Name,Meters:[]},...], count, diag? }
 */
module.exports = async function () {
  try {
    const conn =
      process.env.AzureWebJobsStorage ||
      process.env.STORAGE_CONNECTION_STRING;

    if (!conn) {
      return {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: { success:false, error:"Missing AzureWebJobsStorage/STORAGE_CONNECTION_STRING" }
      };
    }

    const tableName = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
    const client = TableClient.fromConnectionString(conn, tableName);

    const plants = [];
    for await (const ent of client.listEntities()) {
      // SDK exposes lowercase 'partitionKey' and 'rowKey'
      const pkRaw = ent.partitionKey ?? ent.PartitionKey;
      const plantId = Number(ent.Plant_ID ?? pkRaw);
      const plantName = String(ent.Plant_Name ?? "").trim();

      // Meters may be CSV in 'Meters' column
      const metersCsv = String(ent.Meters ?? ent.meters ?? "").trim();
      const meters = metersCsv
        ? metersCsv.split(",").map(s=>s.trim()).filter(Boolean)
        : [];

      if (plantId && plantName) {
        plants.push({ Plant_ID: plantId, Plant_Name: plantName, Meters: meters });
      }
    }

    plants.sort((a,b)=>(a.Plant_ID||0)-(b.Plant_ID||0));

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success:true, data:plants, count:plants.length }
    };
  } catch (err) {
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { success:false, error:String(err && err.message || err) }
    };
  }
};


