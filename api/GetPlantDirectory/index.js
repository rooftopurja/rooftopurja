const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    // Try all likely env var names used across local/emulator/prod
    const conn =
      process.env.PLANT_DIRECTORY_TABLE_CONN ||
      process.env.TABLES_CONNECTION_STRING ||
      process.env.TABLES_CONN_STRING ||
      process.env.STORAGE_CONNECTION_STRING;

    if (!conn) throw new Error("TABLES connection string not configured");

    const tableName = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
    const client = TableClient.fromConnectionString(conn, tableName);

    // Merge by Plant_ID, keep canonical name, union inverter ids
    const byId = new Map();
    for await (const e of client.listEntities()) {
      const id =
        Number(e.Plant_ID ?? e.PlantId ?? e.id ?? e.RowKey ?? e.partitionKey) || 0;
      const name = String(e.DisplayPlant ?? e.Plant_Name ?? e.PlantName ?? "").trim();
      const inv = String(e.Inverters ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      if (!id || !name) continue;

      if (!byId.has(id)) {
        byId.set(id, {
          Plant_ID: id,
          Plant_Name: name,
          DisplayPlant: name,
          Inverters: inv
        });
      } else {
        const cur = byId.get(id);
        // prefer non-empty name
        if (!cur.Plant_Name && name) cur.Plant_Name = name;
        if (!cur.DisplayPlant && name) cur.DisplayPlant = name;
        // union inverter IDs
        cur.Inverters = Array.from(new Set([...(cur.Inverters||[]), ...inv]));
      }
    }

    const data = [...byId.values()].sort((a,b) =>
      String(a.DisplayPlant||a.Plant_Name||"").localeCompare(String(b.DisplayPlant||b.Plant_Name||""))
    );

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { success: true, count: data.length, data }
    };
  } catch (err) {
    context.log.error(err);
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      body: { success: false, error: err.message }
    };
  }
};