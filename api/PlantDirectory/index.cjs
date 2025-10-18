const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    // Connect to PlantDirectory table
    const conn = process.env.TABLES_CONNECTION_STRING || process.env.PLANT_DIRECTORY_TABLE_CONN;
    const tableName = process.env.Plant_Directory_Table || process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
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
    context.log.error("Error in PlantDirectory:", err);
    context.res = { status: 500, body: `Server error: ${err.message}` };
  }
};
