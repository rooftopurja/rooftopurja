const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    const conn =
      process.env.PLANT_DIRECTORY_TABLE_CONN ||
      process.env.TABLES_CONN_STRING;
    const tableName =
      process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";

    context.log("TABLES_CONN_STRING:", process.env.TABLES_CONN_STRING);
    context.log("PLANT_DIRECTORY_TABLE:", process.env.PLANT_DIRECTORY_TABLE);
    const client = TableClient.fromConnectionString(conn, tableName);
    const rows = [];
    for await (const r of client.listEntities()) {
      if (!r.Plant_ID || !r.Plant_Name) continue;
      const inv = (r.Inverters || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      rows.push({ id: r.Plant_ID, name: r.Plant_Name, invIds: inv });
    }

    // merge duplicates
    const merged = Object.values(
      rows.reduce((a, r) => {
        if (!a[r.id]) a[r.id] = r;
        else {
          a[r.id].invIds = Array.from(new Set([...a[r.id].invIds, ...r.invIds]));
        }
        return a;
      }, {})
    );

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: merged,
    };
  } catch (err) {
    context.log.error(err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: err.message },
    };
  }
};

