"use strict";

const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    const conn = process.env.TABLES_CONNECTION_STRING;
    const inverterTables = process.env.INVERTER_TABLES.split(",");
    const inverter = (req.query.inverter || "").trim();
    const date = req.query.date;

    if (!inverter || !date) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing parameters" })
      };
      return;
    }

    let latestRecord = null;

    for (const tableName of inverterTables) {
      const tableClient = TableClient.fromConnectionString(conn, tableName);
      const filter = `PartitionKey eq '${inverter}' and Date eq '${date}'`;

      for await (const entity of tableClient.listEntities({ queryOptions: { filter } })) {
        if (!latestRecord || new Date(entity.Date_Time) > new Date(latestRecord.Date_Time)) {
          latestRecord = entity;
        }
      }
    }

    if (!latestRecord) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          message: "No data found",
          inverter,
          date,
          record: null
        })
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, record: latestRecord })
    };

  } catch (error) {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};
