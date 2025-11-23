"use strict";

const { TableClient } = require("@azure/data-tables");

const conn = process.env.TABLES_CONNECTION_STRING;
const TABLE = "PlantDirectory";

module.exports = async function (context, req) {
  context.log("PlantDirectory called");

  try {
    const client = TableClient.fromConnectionString(conn, TABLE);

    const items = [];

    for await (const e of client.listEntities()) {
      const pid = e.Plant_ID || e.PartitionKey || e.RowKey || "";
      const name = e.Plant_Name || pid;

      const inv = String(e.Inverters || "")
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);

      items.push({
        Plant_ID: String(pid),
        Plant_Name: name,
        Inverters: inv
      });
    }

    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items })
    };
  } catch (err) {
    context.res = {
      status: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [], error: err.message })
    };
  }
};
