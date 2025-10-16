const fs = require("fs");
const path = require("path");

function toISODateOnly(d){ return new Date(d).toISOString().slice(0,10); }
function isISODateOnlyLike(s){ return typeof s==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function parseQS(req){
  const q = req.query || {};
  const start = q.start ? new Date(q.start) : new Date("1900-01-01");
  const end   = q.end   ? new Date(q.end)   : new Date("2099-12-31");
  const top   = Math.max(1, Math.min(parseInt(q.top ?? "100000",10) || 100000, 100000));
  const debug = String(q.debug||"") === "1";
  return { start, end, top, debug };
}

function normalizeRow(e){
  return {
    Plant_ID: Number(e.Plant_ID ?? e.PlantId ?? 0),
    Plant_Name: String(e.Plant_Name ?? e.PlantName ?? "").trim(),
    Meter_ID: String(e.Meter_ID ?? e.MeterId ?? e.PartitionKey ?? ""),
    Meter_Serial_No: String(e.Meter_Serial_No ?? e.MeterSerialNo ?? ""),
    Meter_Make: String(e.Meter_Make ?? e.MeterMake ?? ""),
    Meter_Model: String(e.Meter_Model ?? e.MeterModel ?? ""),
    Meter_Type: String(e.Meter_Type ?? e.MeterType ?? ""),
    Meter_Reading: Number(e.Meter_Reading ?? e.Total_Yield ?? 0),
    Total_Yield: Number(e.Total_Yield ?? e.Meter_Reading ?? 0),
    Yield_Unit: String(e.Total_Yield_Unit ?? e.Yield_Unit ?? "MWh"),
    Incremental_Daily_Yield_KWH: Number(e.Incremental_Daily_Yield_KWH ?? 0),
    Date: e.Date ? String(e.Date) : undefined,
    Date_Time: String(e.Date_Time ?? e.Timestamp ?? e.DateTime ?? "")
  };
}

function inRange(row, start, end){
  if (row.Date && isISODateOnlyLike(row.Date)) {
    const s = toISODateOnly(start), e = toISODateOnly(end);
    const d = String(row.Date);
    return d >= s && d <= e;
  }
  const dt = row.Date_Time ? new Date(row.Date_Time) : null;
  if (!dt || isNaN(+dt)) return false;
  const endInclusive = new Date(end); endInclusive.setHours(23,59,59,999);
  return dt >= start && dt <= endInclusive;
}

async function readFromAzureTable(context){
  const conn = process.env.AzureWebJobsStorage || process.env.STORAGE_CONNECTION_STRING || process.env.TABLES_CONNECTION_STRING;
  if (!conn) throw new Error("No storage connection string in environment");
  const { TableClient } = require("@azure/data-tables");
  const table = TableClient.fromConnectionString(conn, "Premier300Meter");

  const pick = [
    "PartitionKey","RowKey","Timestamp",
    "Plant_ID","Plant_Name",
    "Meter_ID","Meter_Serial_No","Meter_Make","Meter_Model","Meter_Type",
    "Meter_Reading","Total_Yield","Total_Yield_Unit","Yield_Unit",
    "Incremental_Daily_Yield_KWH","Date","Date_Time"
  ];

  const rows = [];
  let scanned = 0;
  const iter = table.listEntities({ queryOptions:{ select: pick }});
  for await (const e of iter){
    scanned++;
    rows.push(normalizeRow(e));
    if (rows.length >= 200000) break;
  }
  return { rows, scanned };
}

function readFromLocalMock(){
  const p = path.join(__dirname,"..","_data","premier300-meter.json");
  if (!fs.existsSync(p)) return { rows:[], scanned:0 };
  const raw = fs.readFileSync(p,"utf8");
  const js = JSON.parse(raw);
  const arr = Array.isArray(js) ? js : (js.data||[]);
  return { rows: arr.map(normalizeRow), scanned: arr.length };
}

function addNoCacheHeaders(h){
  return {
    ...h,
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
  };
}

module.exports = async function (context, req) {
  const { start, end, top, debug } = parseQS(req);
  try{
    let source = "azure";
    let rows = [], scanned = 0;

    try{
      const a = await readFromAzureTable(context);
      rows = a.rows; scanned = a.scanned;
    }catch(inner){
      source = "local";
      context.log.warn("Azure Table read failed, falling back to local mock:", inner.message);
      const a = readFromLocalMock();
      rows = a.rows; scanned = a.scanned;
    }

    let filtered = rows.filter(r => inRange(r, start, end));
    if (filtered.length === 0 && scanned > 0){
      const s = toISODateOnly(start), e = toISODateOnly(end);
      filtered = rows.filter(r => {
        const d = r.Date || (r.Date_Time ? r.Date_Time.slice(0,10) : "");
        return d && d >= s && d <= e;
      });
    }

    filtered.sort((a,b)=> new Date(b.Date_Time||0) - new Date(a.Date_Time||0));
    const data = filtered.slice(0, top);

    const body = {
      success: true,
      version: "GetPremier300MeterAll v5",
      source, scanned,
      count: data.length,
      data
    };
    if (debug) {
      body.debug = {
        start: toISODateOnly(start),
        end: toISODateOnly(end),
        sampleRaw: rows.slice(0,3)
      };
    }

    context.res = { status: 200, headers: addNoCacheHeaders({}), body };
    return;
  }catch(err){
    context.log.error("GetPremier300MeterAll error:", err);
    context.res = {
      status: 200,
      headers: addNoCacheHeaders({}),
      body: { success:false, version:"GetPremier300MeterAll v5", error: String(err && err.message || err), data:[], count:0 }
    };
    return;
  }
};
