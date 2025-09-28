const fs = require("fs");
const path = require("path");

module.exports = async function (context, req) {
  try {
    const p = path.join(__dirname, "..", "_data", "premier300-meter.json");
    const rows = JSON.parse(fs.readFileSync(p, "utf8"));
    rows.sort((a, b) => String(b.Date_Time).localeCompare(String(a.Date_Time)));
    const latest = new Map();
    for (const r of rows) {
      const k = r.Meter_ID || r.Meter_Serial_No;
      if (!latest.has(k)) latest.set(k, r);
    }
    context.res = { headers: { "content-type": "application/json" }, body: { items: [...latest.values()] } };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, headers: { "content-type": "application/json" }, body: { error: "GetPremier300Meter failed", detail: String(err) } };
  }
};
