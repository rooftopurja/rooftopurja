const fs = require("fs");
const path = require("path");
const { TableClient } = require("@azure/data-tables");

function toArray(x){ return Array.isArray(x) ? x : (x?.data || []); }

function normalize(item){
  const id   = Number(item.Plant_ID ?? item.PlantId ?? item.id ?? item.PartitionKey ?? 0);
  const name = String(item.DisplayPlant ?? item.Plant_Name ?? item.PlantName ?? item.name ?? "").trim();
  const inv  = String(item.Inverters ?? "")
                .split(",")
                .map(s => s.trim())
                .filter(Boolean);
  return {
    Plant_ID: id,
    Plant_Name: name || "",
    DisplayPlant: name || "",
    Inverters: inv,
    id: id,
    name: name || ""
  };
}

async function readFromAzure(context){
  const conn =
    process.env.PLANT_DIRECTORY_TABLE_CONN ||
    process.env.TABLES_CONN_STRING ||
    process.env.TABLES_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage;

  const tableName = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
  if (!conn) { context.log.warn("No table connection string found"); return []; }

  const client = TableClient.fromConnectionString(conn, tableName);
  const out = [];
  for await (const r of client.listEntities()) out.push(normalize(r));
  return out;
}

function readFromLocal(context){
  const fp = path.join(__dirname, "..", "_data", "plant-directory.json");
  if (!fs.existsSync(fp)) { context.log.warn("Local plant-directory.json not found"); return []; }
  try{
    const raw = fs.readFileSync(fp, "utf8");
    const arr = toArray(JSON.parse(raw)).map(normalize);
    return arr;
  }catch(e){
    context.log.error("Failed reading local plant-directory.json:", e);
    return [];
  }
}

module.exports = async function (context, req) {
  try{
    // 1) Azure table
    let rows = await readFromAzure(context);

    // merge by Plant_ID, prefer names, union Inverters
    const byId = new Map();
    for (const r of rows){
      if (!r.Plant_ID) continue;
      const cur = byId.get(r.Plant_ID);
      if (!cur) byId.set(r.Plant_ID, { ...r });
      else {
        if (!cur.Plant_Name && r.Plant_Name)   cur.Plant_Name   = r.Plant_Name;
        if (!cur.DisplayPlant && r.DisplayPlant) cur.DisplayPlant = r.DisplayPlant;
        cur.name = cur.DisplayPlant || cur.Plant_Name || cur.name || "";
        cur.Inverters = Array.from(new Set([...(cur.Inverters||[]), ...(r.Inverters||[])]));
      }
    }

    // 2) Fallback to local if Azure returned nothing
    if (byId.size === 0){
      context.log.warn("PlantDirectory from Azure returned 0 rows — using local fallback.");
      for (const r of readFromLocal(context)){
        if (!r.Plant_ID) continue;
        if (!byId.has(r.Plant_ID)) byId.set(r.Plant_ID, { ...r });
      }
    }

    const data = [...byId.values()].sort((a,b) =>
      String(a.DisplayPlant || a.Plant_Name || "").localeCompare(String(b.DisplayPlant || b.Plant_Name || ""))
    ).map(r => ({
      ...r,
      id: r.Plant_ID,
      name: r.DisplayPlant || r.Plant_Name || r.name || ""
    }));

    return {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: { success:true, count:data.length, data }
    };
  }catch(err){
    context.log.error("GetPlantDirectory error:", err);
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      body: { success:false, error:String(err && err.message || err) }
    };
  }
};
