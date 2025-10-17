import { makeTable } from "../shared/azure.js";

function parseDate(d){ try{ return new Date(d); }catch{ return null; } }

export default async function (context, req) {
  try {
    const view = (req.query.view||"day").toLowerCase();
    const date = parseDate(req.query.date) || new Date();
    const plantId = req.query.plantId;
    const inverterId = req.query.inverterId;

    // Tables to poll (no merged table) – extend if you add more:
    const tables = (process.env.INVERTER_TABLES || "SungrowInverter125KW,SungrowInverter80KW,SungrowInverter60KW")
                    .split(",").map(s=>s.trim()).filter(Boolean);

    const account = process.env.STORAGE_ACCOUNT_NAME; // optional when using conn string

    const startDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const endDay   = new Date(startDay); endDay.setUTCDate(endDay.getUTCDate()+1);

    const results = [];

    for (const tName of tables) {
      const table = makeTable(account, tName);

      // Filter rows by PartitionKey/RowKey if your schema uses them; otherwise basic scan + filter:
      for await (const e of table.listEntities()) {
        const dt = new Date(e.Date_Time || e.Timestamp || e.RowKey?.slice(0,8));
        if (isNaN(dt)) continue;
        if (!(dt >= startDay && dt < endDay)) continue;

        if (plantId && (String(e.Plant_ID||"") !== String(plantId))) continue;
        if (inverterId && (String(e.Inverter_ID||e.InverterId||"") !== String(inverterId))) continue;

        results.push({
          table: tName,
          dateTime: dt.toISOString(),
          plantId: e.Plant_ID ?? null,
          inverterId: e.Inverter_ID ?? e.InverterId ?? null,
          acKw: Number(e.Total_AC_Power_KW ?? 0),
          dcKw: Number(e.Total_DC_Power_KW ?? 0),
          yieldKWh: Number(e.Daily_Yield_KWH ?? 0),
          totalYieldMWh: Number(e.Total_Yield ?? 0)
        });
      }
    }

    // quick aggregates
    const totalYieldKWh = results.reduce((s,r)=> s + (r.yieldKWh||0), 0);
    const maxAc = results.reduce((m,r)=> Math.max(m, r.acKw||0), 0);
    const maxDc = results.reduce((m,r)=> Math.max(m, r.dcKw||0), 0);

    context.res = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { view, date: startDay.toISOString().slice(0,10), rows: results, totals: { totalYieldKWh, maxAc, maxDc } }
    };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: { error: String(err?.message||err) } };
  }
}
