import { makeClients, parseStart, parseEnd } from "../_lib/table.js";

const ACCOUNT = process.env.STORAGE_ACCOUNT_NAME;
const TABLES  = (process.env.METER_TABLES || process.env.METER_TABLE || "").split(",").map(s=>s.trim()).filter(Boolean);

export default async function (context, req) {
  try{
    // quick sanity
    if(!ACCOUNT && !process.env.TABLES_CONNECTION_STRING && !process.env.STORAGE_CONNECTION_STRING){
      context.res = { status: 500, body: { error: "No auth available: set STORAGE_ACCOUNT_NAME for MSI or TABLES_CONNECTION_STRING" } };
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

    // --- diagnostics mode: ?diag=1 ---
    if ((req.query.diag||"") === "1") {
      const diag = [];
      for(const t of TABLES){
        try{
          const { table } = makeClients(ACCOUNT, t);
          // top-1 probe
          let any = false;
          for await (const e of table.listEntities({ queryOptions: { top: 1 } })){ any = true; break; }
          diag.push({ table:t, ok:true, sample:any });
        }catch(err){
          diag.push({ table:t, ok:false, message:String(err?.message||err) });
        }
      }
      context.res = { status: 200, body: {
        auth: (process.env.TABLES_CONNECTION_STRING||process.env.STORAGE_CONNECTION_STRING) ? "connectionString" : "managedIdentity",
        account: ACCOUNT || "(from connection string)",
        tables: TABLES,
        start: start?.toISOString()||null,
        end: end?.toISOString()||null,
        diag
      }};
      return;
    }

    // --- normal read across all tables (aggregate) ---
    const rows = [];
    const errors = [];
    for(const tableName of TABLES){
      try{
        const { table } = makeClients(ACCOUNT, tableName);
        const filters = [];
        if(start)   filters.push(`Timestamp ge datetime'${start.toISOString()}'`);
        if(end)     filters.push(`Timestamp le datetime'${end.toISOString()}'`);
        if(plantId) filters.push(`(Plant_ID eq '${plantId}' or PlantId eq '${plantId}' or Plant eq '${plantId}')`);
        const filter = filters.length ? filters.join(" and ") : undefined;

        let count = 0;
        for await (const e of table.listEntities({ queryOptions: { filter } })){
          rows.push({ table: tableName, ...e });
          if(++count >= top) break;
        }
      }catch(err){
        errors.push({ table: tableName, error: String(err?.message||err) });
      }
    }

    if (errors.length && !rows.length) {
      context.res = { status: 500, body: { error: "read failed", details: errors } };
      return;
    }

    context.res = { status: 200, body: { rows, errors } };
  }catch(err){
    context.res = { status: 500, body: { error: String(err?.message||err) } };
  }
}
