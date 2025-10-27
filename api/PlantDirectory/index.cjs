const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    // 🌐 Resolve connection string safely for both SWA emulator and Azure cloud
    const conn =
      process.env.TABLES_CONNECTION_STRING ||
      process.env.PLANT_DIRECTORY_TABLE_CONN ||
      process.env.AzureWebJobsStorage;

    const tableName =
      process.env.Plant_Directory_Table ||
      process.env.PLANT_DIRECTORY_TABLE ||
      "PlantDirectory";

    if (!conn) throw new Error("Storage connection string not found.");

    const client = TableClient.fromConnectionString(conn, tableName);
    const results = [];

    for await (const entity of client.listEntities()) {
      results.push(entity);
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: results
    };
  } catch (err) {
    context.log.error("❌ Error in PlantDirectory:", err);
    context.res = { status: 500, body: { error: err.message } };
  }
};
