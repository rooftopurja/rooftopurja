// GetPremier300MeterAll v4 — normalized totals with unit-safe math
const fs = require("fs");
const path = require("path");

function toISODateOnly(d){ return d.toISOString().slice(0,10); }

function parseQS(req){
  const start = req.query?.start ? new Date(req.query.start) : new Date("1900-01-01");
  const end   = req.query?.end   ? new Date(req.query.end)   : new Date("2099-12-31");
  const top   = Math.max(0, Math.min(parseInt(req.query?.top ?? "1000",10) || 1000, 100000));
  return { start, end, top };
}

// --- Unit helpers ---
function pickUnit(u){
  if (!u) return "MWh";
  const m = String(u).toLowerCase().match(/(kwh|mwh|gwh)/);
  return m ? m[1].toUpperCase() : "MWh";
}
function toMWh(value, unit){
  const v = Number(value || 0);
  const u = pickUnit(unit);
  if (u === "KWH") return v / 1000;
  if (u === "MWH") return v;
  if (u === "GWH") return v * 1000;
  return v; // default treat as MWh
}

// Azure Table row → normalized row we return to the UI
function normalizeRow(e){
  const row = {
    Plant_ID: Number(e.Plant_ID ?? e.PlantId ?? 0),
    Plant_Name: String(e.Plant_Name ?? e.PlantName ?? "").trim(),
    Meter_ID: String(e.Meter_ID ?? e.MeterId ?? e.PartitionKey ?? ""),
    Meter_Serial_No: String(e.Meter_Serial_No ?? e.MeterSerialNo ?? ""),
    Meter_Make: String(e.Meter_Make ?? e.MeterMake ?? ""),
    Meter_Model: String(e.Meter_Model ?? e.MeterModel ?? ""),
    Meter_Type: String(e.Meter_Type ?? e.MeterType ?? ""),
    // raw readings as stored in SQL schema (columns exist in your table)  :contentReference[oaicite:0]{index=0}
    Meter_Reading: Number(e.Meter_Reading ?? e.Total_Yield ?? 0),
    Total_Yield: Number(e.Total_Yield ?? e.Meter_Reading ?? 0),
    Yield_Unit: String(e.Yield_Unit ?? e.Total_Yield_Unit ?? "MWh"),
    Total_Yield_Unit: String(e.Total_Yield_Unit ?? e.Yield_Unit ?? "MWh"),
    Incremental_Daily_Yield_KWH: Number(e.Incremental_Daily_Yield_KWH ?? e.Daily_Yield_KWH ?? 0),
    Date_Time: String(e.Date_Time ?? e.Timestamp ?? e.DateTime ?? ""),
    Date: e.Date ? String(e.Date) : undefined
  };
  // derived, unit-safe fields for the frontend
  row.Total_Yield_MWh = toMWh(row.Total_Yield, row.Total_Yield_Unit);
  row.Daily_Yield_KWH = Number(row.Incremental_Daily_Yield_KWH || 0);
  return row;
}

function inRange(row, start, end){
  // Prefer explicit Date (YYYY-MM-DD) if present; else use Date_Time
  if (row.Date){
    const s = toISODateOnly(start), e = toISODateOnly(end);
    return row.Date >= s && row.Date <= e;
  }
  const dt = row.Date_Time ? new Date(row.Date_Time) : null;
  if (!dt || isNaN(+dt)) return false;
  // inclusive of the End day
  return dt >= start && dt <= new Date(end.getTime() + 24*60*60*1000 - 1);
}

async function tryAzureTables(context, start, end, top){
  const conn = process.env.AzureWebJobsStorage || process.env.STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("No storage connection string");
  const { TableClient } = require("@azure/data-tables");
  const table = TableClient.fromConnectionString(conn, "Premier300Meter");

  const rows = [];
  const iter = table.listEntities({
    queryOptions:{
      select:[
        "PartitionKey","RowKey","Timestamp",
        "Plant_ID","Plant_Name",
        "Meter_ID","Meter_Serial_No","Meter_Make","Meter_Model","Meter_Type",
        "Meter_Reading","Total_Yield","Yield_Unit","Total_Yield_Unit",
        "Incremental_Daily_Yield_KWH","Daily_Yield_KWH",
        "Date","Date_Time"
      ]
    }
  });

  for await (const e of iter){
    const r = normalizeRow(e);
    if (inRange(r, start, end)) rows.push(r);
    if (rows.length >= top) break;
  }
  rows.sort((a,b)=> new Date(b.Date_Time) - new Date(a.Date_Time));
  return rows.slice(0, top);
}

function tryLocalFile(context, start, end, top){
  const p = path.join(__dirname,"..","_data","premier300-meter.json");
  if (!fs.existsSync(p)) return [];
  const js = JSON.parse(fs.readFileSync(p,"utf8"));
  const rows = (Array.isArray(js)? js : (js.data||[]))
    .map(normalizeRow)
    .filter(r=>inRange(r,start,end))
    .sort((a,b)=> new Date(b.Date_Time) - new Date(a.Date_Time))
    .slice(0, top);
  return rows;
}

module.exports = async function (context, req) {
  const { start, end, top } = parseQS(req);
  try{
    let data = [];
    try {
      data = await tryAzureTables(context, start, end, top);
    } catch (inner) {
      context.log.warn("Falling back to local file:", inner.message);
      data = tryLocalFile(context, start, end, top);
    }
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success:true, version:"GetPremier300MeterAll v4", count:data.length, data }
    };
  }catch(err){
    context.log.error("GetPremier300MeterAll error:", err);
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success:false, version:"GetPremier300MeterAll v4", error: err.message, data:[], count:0 }
    };
  }
};
