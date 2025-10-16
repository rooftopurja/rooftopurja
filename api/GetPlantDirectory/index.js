"use strict";
const { TableClient } = require("@azure/data-tables");
const fs = require("fs");
const path = require("path");

async function readAzure(context){
  const conn  = process.env.PLANT_DIRECTORY_TABLE_CONN
             || process.env.TABLES_CONNECTION_STRING
             || process.env.TABLES_CONN_STRING
             || process.env.AzureWebJobsStorage;
  const table = process.env.PLANT_DIRECTORY_TABLE || "PlantDirectory";
  if (!conn) throw new Error("No table connection string in env");

  const client = TableClient.fromConnectionString(conn, table);
  const map = new Map();
  let scanned = 0;

  for await (const e of client.listEntities()){
    scanned++;
    const id   = Number(e.Plant_ID ?? e.PlantId ?? 0);
    const name = String(e.Plant_Name ?? e.PlantName ?? "").trim();
    const inv  = String(e.Inverters || "")
                  .split(",").map(s=>s.trim()).filter(Boolean);
    if (!id) continue;

    if (!map.has(id)) {
      map.set(id, { Plant_ID:id, Plant_Name:name, DisplayPlant:name, Inverters:[...new Set(inv)] });
    } else {
      const cur = map.get(id);
      if (!cur.Plant_Name && name) cur.Plant_Name = name, cur.DisplayPlant = name;
      cur.Inverters = [...new Set([...(cur.Inverters||[]), ...inv])];
    }
  }
  context.log("PlantDirectory scanned:", scanned, "unique:", map.size);
  return [...map.values()].sort((a,b)=>
    String(a.DisplayPlant||a.Plant_Name||"").localeCompare(String(b.DisplayPlant||b.Plant_Name||""))
  );
}

function readLocal(){
  try{
    const p = path.join(__dirname,"..","_data","plant-directory.json");
    const js = JSON.parse(fs.readFileSync(p,"utf8"));
    return Array.isArray(js) ? js : (js.data||[]);
  }catch(_){ return []; }
}

module.exports = async function(context, req){
  try{
    let rows = [];
    try { rows = await readAzure(context); }
    catch(e){ context.log.warn("Azure read failed:", e.message); rows = readLocal(); }

    const bodyObj = { success:true, count: rows.length, data: rows };
    context.res = { status:200, headers:{ "content-type":"application/json" }, body: JSON.stringify(bodyObj) };
  }catch(err){
    context.log.error(err);
    context.res = { status:500, headers:{ "content-type":"application/json" }, body: JSON.stringify({ success:false, error:String(err && err.message || err) }) };
  }
  return;
};
