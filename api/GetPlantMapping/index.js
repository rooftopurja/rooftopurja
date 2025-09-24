// GetPlantMapping/index.js
const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    // Use connection string (never undefined if set in local.settings.json)
    const conn =
      process.env.STORAGE_CONNECTION_STRING ||
      process.env.AzureWebJobsStorage;

    if (!conn) {
      throw new Error(
        "Missing STORAGE_CONNECTION_STRING / AzureWebJobsStorage in local.settings.json"
      );
    }

    const tableName = process.env.PLANT_MAPPING_TABLE || "PlantMapping";
    const client = TableClient.fromConnectionString(conn, tableName);

    const items = [];
    for await (const e of client.listEntities()) {
      items.push({
        Plant_ID: Number(e.Plant_ID ?? e.partitionKey ?? 0),
        Device_ID: e.Device_ID ?? e.rowKey ?? "",
        Device_Name: e.Device_Name ?? "",
        Plant_Name: e.Plant_Name ?? ""
      });
    }

    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { items }
    };
  } catch (err) {
    context.log.error("GetPlantMapping error:", err);
    context.res = {
      status: 500,
      headers: { "content-type": "application/json" },
      body: { error: String(err.message || err) }
    };
  }
};
