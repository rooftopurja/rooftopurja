const fs = require("fs");
const path = require("path");

function safeParse(txt) {
  if (!txt || !txt.trim()) return [];
  const clean = txt.replace(/^\uFEFF/, "").trim();
  try { return JSON.parse(clean); } catch { return []; }
}

module.exports = async function (context, req) {
  try {
    const p = path.join(__dirname, "..", "_data", "premier300-meter.json");
    const rows = safeParse(fs.readFileSync(p, "utf8"));

    // Latest row per meter (by Date_Time)
    const map = new Map();
    for (const r of rows) {
      const id = r.Meter_ID ?? r.MeterId ?? r.meter_id ?? "";
      const t  = new Date(r.Date_Time ?? r.timestamp ?? r.datetime ?? 0).getTime();
      const prev = map.get(id);
      if (!prev || t > prev.__t) {
        map.set(id, { ...(r||{}), __t: t });
      }
    }
    const data = Array.from(map.values()).map(({__t, ...r}) => r);

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, data, count: data.length, version: "GetPremier300Meter v2" }
    };
  } catch (err) {
    context.log.error("GetPremier300Meter error:", err?.message);
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, data: [], count: 0, version: "GetPremier300Meter v2", note: "empty-on-error" }
    };
  }
};


