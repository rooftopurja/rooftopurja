const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    const conn =
      process.env.PLANT_DIRECTORY_TABLE_CONN ||
      process.env.TABLES_CONN_STRING ||
      process.env.TABLES_CONNECTION_STRING ||              // alt variable you had in env
      process.env.AzureWebJobsStorage;                     // final fallback

    const tableName = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
    const client = TableClient.fromConnectionString(conn, tableName);

    // Merge by Plant_ID; prefer non-empty names; union inverter lists
    const byId = new Map();

    for await (const r of client.listEntities()) {
      const id   = Number(r.Plant_ID ?? r.PlantId ?? r.PartitionKey ?? 0);
      if (!id) continue;

      const name = String(r.DisplayPlant ?? r.Plant_Name ?? r.PlantName ?? "").trim();
      const inv  = String(r.Inverters ?? "")
                    .split(",")
                    .map(s => s.trim())
                    .filter(Boolean);

      if (!byId.has(id)) {
        byId.set(id, {
          Plant_ID: id,
          Plant_Name: name || "",
          DisplayPlant: name || "",
          Inverters: inv
        });
      } else {
        const cur = byId.get(id);
        if (!cur.Plant_Name && name)    cur.Plant_Name = name;
        if (!cur.DisplayPlant && name)  cur.DisplayPlant = name;
        cur.Inverters = Array.from(new Set([...(cur.Inverters||[]), ...inv]));
      }
    }

    const data = [...byId.values()].sort((a,b) =>
      String(a.DisplayPlant || a.Plant_Name || "")
        .localeCompare(String(b.DisplayPlant || b.Plant_Name || ""))
    );

    // Keep existing UI happy: include id/name in addition to Plant_ID/Plant_Name/DisplayPlant
    const compat = data.map(r => ({
      ...r,
      id: r.Plant_ID,
      name: r.DisplayPlant || r.Plant_Name
    }));

    return {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: { success: true, count: compat.length, data: compat }
    };
  } catch (err) {
    context.log.error("GetPlantDirectory error:", err);
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      body: { success: false, error: String(err && err.message || err) }
    };
  }
};
