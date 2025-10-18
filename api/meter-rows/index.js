import { DefaultAzureCredential } from "@azure/identity";
import { TableClient } from "@azure/data-tables";

// ENV expected in SWA -> Environment variables
const ACCOUNT = process.env.STORAGE_ACCOUNT_NAME;        // e.g. "solariothubstorage"
const TABLES  = (process.env.METER_TABLES || "").split(",").map(s=>s.trim()).filter(Boolean); // e.g. "Premier300Meter"

function toISOStart(s){
  // accept dd-mm-yyyy or yyyy-mm-dd
  if(!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  return new Date(iso+"T00:00:00Z");
}
function toISOEnd(s){
  if(!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  return new Date(iso+"T23:59:59Z");
}

export default async function (context, req) {
  try{
    if(!ACCOUNT || TABLES.length===0){
      context.res = { status: 500, body: { error: "Missing STORAGE_ACCOUNT_NAME or METER_TABLES" } };
      return;
    }
    const start = toISOStart(req.query.start);
    const end   = toISOEnd(req.query.end);
    const top   = Math.max(1, Math.min( parseInt(req.query.top||"1000",10) || 1000, 100000));
    const plantId = (req.query.plantId||"").trim();

    const cred = new DefaultAzureCredential();
    const rows = [];

    // Query each table; filter by Timestamp and optional plant
    for(const t of TABLES){
      const url = `https://${ACCOUNT}.table.core.windows.net`;
      const client = new TableClient(url, t, cred);

      // Build OData filter
      let filters = [];
      if(start) filters.push(`Timestamp ge datetime'${start.toISOString()}'`);
      if(end)   filters.push(`Timestamp le datetime'${end.toISOString()}'`);
      if(plantId) filters.push(`(Plant_ID eq '${plantId}' or PlantId eq '${plantId}' or Plant eq '${plantId}')`);
      const filter = filters.length ? filters.join(" and ") : undefined;

      let count = 0;
      for await (const entity of client.listEntities({ queryOptions: { filter } })){
        rows.push({ table:t, ...entity });
        count++;
        if(count>=top) break;
      }
    }

    context.res = { status: 200, body: { rows } };
  }catch(err){
    context.log("meter-rows error:", err?.message||err);
    context.res = { status: 500, body: { error: String(err?.message||err) } };
  }
}
