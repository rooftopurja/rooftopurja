const fs = require("fs");
const path = require("path");

function safeParse(jsonText) {
  if (!jsonText || !jsonText.trim()) return [];
  const clean = jsonText.replace(/^\uFEFF/, "").trim(); // strip BOM
  try { return JSON.parse(clean); } catch { return []; }
}

// yyyy-mm-dd to Date (midnight)
function toDate(d) {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

module.exports = async function (context, req) {
  try {
    const dataPath = path.join(__dirname, "..", "_data", "premier300-meter.json");
    const raw = fs.readFileSync(dataPath, "utf8");
    const rows = safeParse(raw);

    // Normalise: ensure the fields our UI expects exist
    const norm = rows.map(r => ({
      Meter_ID:                r.Meter_ID ?? r.MeterId ?? r.meter_id ?? "",
      Meter_Serial_No:         r.Meter_Serial_No ?? r.Serial_No ?? r.serial ?? "",
      Meter_Make:              r.Meter_Make ?? r.Make ?? r.make ?? "",
      Meter_Model:             r.Meter_Model ?? r.Model ?? r.model ?? "",
      Meter_Type:              r.Meter_Type ?? r.Type ?? r.type ?? "",
      Total_Yield:             Number(r.Total_Yield ?? r.total_mwh ?? r.Total_MWh ?? 0),
      Yield_Unit:              r.Yield_Unit ?? r.Unit ?? "MWh",
      Incremental_Daily_Yield_KWH: Number(r.Incremental_Daily_Yield_KWH ?? r.daily_kwh ?? r.Daily_kWh ?? 0),
      Date_Time:               r.Date_Time ?? r.timestamp ?? r.Time ?? r.datetime ?? "",
      Plant_ID:                Number(r.Plant_ID ?? r.plant_id ?? r.PlantId ?? 0)
    }));

    // Filter by date range
    const start = toDate(req.query?.start);
    const end   = toDate(req.query?.end);
    let filtered = norm;
    if (start || end) {
      filtered = filtered.filter(x => {
        const t = new Date(x.Date_Time);
        return (!start || t >= start) && (!end || t <= new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999));
      });
    }

    // Sort newest first
    filtered.sort((a, b) => new Date(b.Date_Time) - new Date(a.Date_Time));

    // top=
    const top = Math.max(0, Number(req.query?.top ?? 0));
    const data = top ? filtered.slice(0, top) : filtered;

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, data, count: data.length, version: "GetPremier300MeterAll v2" }
    };
  } catch (err) {
    context.log.error("GetPremier300MeterAll error:", err?.message);
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, data: [], count: 0, version: "GetPremier300MeterAll v2", note: "empty-on-error" }
    };
  }
};
