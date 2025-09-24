const { TableClient } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");

function ymd(d){ return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function parseYMD(s){
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(s+"T00:00:00Z"); if (isNaN(dt)) return null; return dt;
}

module.exports = async function (context, req) {
  try {
    const accountUrl = process.env.STORAGE_ACCOUNT_URL;
    const tableName  = process.env.PREMIER_TABLE || "Premier300Meter";
    const cred   = new DefaultAzureCredential();
    const client = new TableClient(accountUrl, tableName, cred);

    // inputs
    const plantIdRaw = (req.query.plantId ?? "").toString().trim();
    const isAll = plantIdRaw.toLowerCase() === "all" || plantIdRaw === "" || plantIdRaw === "0";
    const top = Math.min(parseInt(req.query.top || "1000",10) || 1000, 5000);

    let start = parseYMD(req.query.start);
    let end   = parseYMD(req.query.end);

    // Safe, friendly defaults
    const today = new Date();
    if (!end) end = today;
    if (!start) {
      // If caller provided neither start nor end (or only top), show last 7 days
      const d = new Date(end.getTime() - 6*24*3600*1000);
      start = d;
    }

    const startStr = ymd(start);
    const endStr   = ymd(end);

    // Pull rows. Azure Tables filtering on custom props is limited, so we read & filter in-process.
    const items = [];
    let count = 0;

    // helper: push row if within date window
    const pushIfInRange = (e) => {
      // prefer Date or Date_Time
      const dateStr = (e.Date || (e.Date_Time ? e.Date_Time.slice(0,10) : null));
      if (!dateStr) return;
      if (dateStr < startStr || dateStr > endStr) return;

      items.push({
        Plant_ID:   e.Plant_ID ?? e.PartitionKey ?? null,
        Meter_ID:   e.Meter_ID ?? null,
        Meter_Make: e.Meter_Make ?? "Secure",
        Meter_Model:e.Meter_Model ?? "Premier300",
        Meter_Serial_No: e.Meter_Serial_No ?? null,
        Total_Yield: e.Total_Yield ?? null,
        Incremental_Daily_Yield_KWH: e.Incremental_Daily_Yield_KWH ?? 0,
        Yield_Unit: e.Yield_Unit ?? "kWh",
        Date:       e.Date ?? null,
        Date_Time:  e.Date_Time ?? null
      });
      count++;
    };

    // Iterate
    if (isAll) {
      for await (const e of client.listEntities()) {
        pushIfInRange(e);
        if (count >= top) break;
      }
    } else {
      // partitionKey equals Plant_ID in your data
      const p = plantIdRaw;
      for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${p}'` } })) {
        pushIfInRange(e);
        if (count >= top) break;
      }
    }

    // sort newest first (Date_Time desc), then Meter_ID
    items.sort((a,b)=>{
      const ta = (a.Date_Time||""); const tb = (b.Date_Time||"");
      if (ta>tb) return -1; if (ta<tb) return 1;
      return String(a.Meter_ID||"").localeCompare(String(b.Meter_ID||""));
    });

    context.res = { status: 200, body: { items } };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 200, body: { items: [] } }; // never hard fail the charts
  }
};
