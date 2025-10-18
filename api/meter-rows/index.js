import { getClient, parseStart, parseEnd } from "../_lib/table.js";

const ACCOUNT = process.env.STORAGE_ACCOUNT_NAME;
const TABLES  = (process.env.METER_TABLES || process.env.METER_TABLE || "").split(",").map(s=>s.trim()).filter(Boolean);

export default async function (context, req) {
  try{
    // Validate environment first
    if(!ACCOUNT){
      context.res = { status: 500, body: { error: "STORAGE_ACCOUNT_NAME not set" } };
      return;
    }
    if(!TABLES.length){
      context.res = { status: 500, body: { error: "METER_TABLES not set or empty" } };
      return;
    }

    const start = parseStart(req.query.start);
    const end   = parseEnd(req.query.end);
    const top   = Math.max(1, Math.min(parseInt(req.query.top||"20000",10)||20000, 200000));
    const plantId = (req.query.plantId||"").trim();

    const rows = [];
    for(const table of TABLES){
      const client = getClient(ACCOUNT, table);

      // Build filter
      const filters = [];
      if(start)   filters.push(`Timestamp ge datetime'${start.toISOString()}'`);
      if(end)     filters.push(`Timestamp le datetime'${end.toISOString()}'`);
      if(plantId) filters.push(`(Plant_ID eq '${plantId}' or PlantId eq '${plantId}' or Plant eq '${plantId}')`);
      const filter = filters.length ? filters.join(" and ") : undefined;

      let count = 0;
      try{
        for await (const e of client.listEntities({ queryOptions: { filter } })){
          rows.push({ table, ...e });
          if(++count>=top) break;
        }
      }catch(inner){
        // Bubble up table-specific error (very helpful)
        context.res = { status: 500, body: { error: `Table '${table}' read failed: ${inner?.message||inner}` } };
        return;
      }
    }

    context.res = { status: 200, body: { rows } };
  }catch(err){
    // Final guard
    context.log("meter-rows fatal:", err);
    context.res = { status: 500, body: { error: String(err?.message||err) } };
  }
}
