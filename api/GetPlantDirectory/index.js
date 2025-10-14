// GetPlantDirectory — stable reader for the PlantDirectory table
// npm i @azure/data-tables
const { TableClient } = require("@azure/data-tables");

const STORAGE_CONN = process.env.STORAGE_CONN || process.env.AzureWebJobsStorage;
const TABLE = "PlantDirectory";

module.exports = async function (context, req) {
  try {
    if (!STORAGE_CONN) {
      context.log.error("Missing AzureWebJobsStorage/STORAGE_CONN");
      context.res = { status: 500, body: { error: "storage-connection-missing" } };
      return;
    }

    const client = TableClient.fromConnectionString(STORAGE_CONN, TABLE);

    const rows = [];
    for await (const e of client.listEntities()) {
      const Plant_ID =
        String(e.Plant_ID ?? e.plant_id ?? e.PartitionKey ?? e.RowKey ?? "").trim();
      const Plant_Name =
        String(e.Plant_Name ?? e.plant_name ?? e.name ?? `Plant ${Plant_ID}`).trim();
      const Inverters =
        e.Inverters ?? e.inverters ?? e.Devices ?? e.devices ?? e.Inverter_ID ?? "";

      if (Plant_ID) rows.push({ Plant_ID, Plant_Name, Inverters });
    }

    rows.sort((a, b) => {
      const na = Number(a.Plant_ID), nb = Number(b.Plant_ID);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a.Plant_ID).localeCompare(String(b.Plant_ID));
    });

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: rows,
    };
  } catch (err) {
    context.log.error("GetPlantDirectory failed:", err?.message || err);
    // fail soft: return empty array so front-end keeps working
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: [],
    };
  }
};
