const fs = require("fs");
const path = require("path");

function dOnly(s){
  if(!s) return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try { return new Date(s).toISOString().slice(0,10); } catch { return null; }
}

module.exports = async function (context, req) {
  try {
    const p = path.join(__dirname, "..", "_data", "premier300-meter.json");
    let rows = JSON.parse(fs.readFileSync(p, "utf8"));

    const start = dOnly(req.query.start);
    const end   = dOnly(req.query.end);
    const top   = Math.min(parseInt(req.query.top || "20000",10) || 20000, 200000);
    const plantIds = (req.query.plantIds || "").split(",").map(s=>s.trim()).filter(Boolean);

    rows = rows.filter(r => !!r.Date_Time);
    if(start) rows = rows.filter(r => String(r.Date_Time).slice(0,10) >= start);
    if(end)   rows = rows.filter(r => String(r.Date_Time).slice(0,10) <= end);
    if(plantIds.length) rows = rows.filter(r => plantIds.includes(String(r.Plant_ID)));

    rows.sort((a,b)=> String(b.Date_Time).localeCompare(String(a.Date_Time)));
    rows = rows.slice(0, top);

    context.res = { headers: { "content-type": "application/json" }, body: { items: rows } };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, headers: { "content-type": "application/json" }, body: { error: "GetPremier300MeterAll failed", detail: String(err) } };
  }
};
