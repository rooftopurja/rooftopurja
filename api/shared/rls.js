const { Buffer } = require("buffer");

function getUser(req){
  try{
    const b64 = req.headers["x-ms-client-principal"];
    if(!b64) return null;
    const json = Buffer.from(b64, "base64").toString("utf8");
    const p = JSON.parse(json);
    return {
      email: String(p.userDetails||"").toLowerCase(),
      roles: Array.isArray(p.userRoles)? p.userRoles : [],
      raw: p
    };
  }catch{ return null; }
}

async function getAllowedPlants(context, user){
  if(!user) return { all:false, ids:[] };
  if((user.roles||[]).includes("admin")) return { all:true, ids:[] };

  const conn = process.env.AzureWebJobsStorage || process.env.STORAGE_CONNECTION_STRING;
  try{
    const { TableClient } = require("@azure/data-tables");
    // Use your existing table
    const table = TableClient.fromConnectionString(conn, "UserPlantAccess");
    // PK is just the email (lowercase)
    const pk = user.email;
    const ids = [];
    const iter = table.listEntities({ queryOptions:{ filter: `PartitionKey eq '${pk}'` }});
    for await (const e of iter){
      const id = Number(e.Plant_ID ?? e.RowKey ?? 0);
      if(id) ids.push(id);
    }
    return { all:false, ids };
  }catch(err){
    context.log.warn("RLS: UserPlantAccess not available:", err.message);
    return { all:false, ids:[] };
  }
}

function applyRls(rows, grant){
  if(grant.all) return rows;
  if(!grant.ids || grant.ids.length===0) return [];
  const allow = new Set(grant.ids.map(Number));
  return rows.filter(r => allow.has(Number(r.Plant_ID)));
}

module.exports = { getUser, getAllowedPlants, applyRls };



