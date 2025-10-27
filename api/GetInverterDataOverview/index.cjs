const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    const plant = (req.query.plant || "ESIC_Kalaburagi_Hospital").trim();
    const inverter = (req.query.inverter || "Inverter_16").trim(); // default updated here ✅
    const date = req.query.date;
    if (!date) {
      return {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing 'date' parameter" })
      };
    }

    const connectionString = process.env.TABLES_CONNECTION_STRING;
    const inverterTables = process.env.INVERTER_TABLES.split(",");

    let latestRecord = null;

    // Loop through all inverter tables directly
    for (const tableName of inverterTables) {
      const tableClient = TableClient.fromConnectionString(connectionString, tableName);
      const filter = `PartitionKey eq '${inverter}' and Date eq '${date}'`;

      for await (const entity of tableClient.listEntities({ queryOptions: { filter } })) {
        if (!latestRecord || new Date(entity.Date_Time) > new Date(latestRecord.Date_Time)) {
          latestRecord = entity;
        }
      }
    }

    if (!latestRecord) {
      return {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `No data found for ${inverter} on ${date}` })
      };
    }

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(latestRecord)
    };
  } catch (error) {
    context.log.error("Error in GetInverterDataOverview:", error);
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};
