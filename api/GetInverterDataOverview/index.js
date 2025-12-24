"use strict";

const https = require("https");

/* ================= ENV ================= */
const TABLE_ENDPOINT =
  process.env.TABLE_STORAGE_URL ||
  process.env.AZURE_TABLE_ENDPOINT;

const TABLE_SAS =
  process.env.TABLE_STORAGE_SAS ||
  process.env.AZURE_TABLE_SAS;

const INVERTER_TABLES = (process.env.INVERTER_TABLES || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

const MASTER_TABLE = "SungrowInverter125KW";

/* ================= REST GET ================= */
function tableGET(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      { headers: { Accept: "application/json;odata=nometadata" } },
      res => {
        let buf = "";
        res.on("data", d => (buf += d));
        res.on("end", () => {
          if (res.statusCode >= 300) {
            return reject(new Error(buf));
          }
          resolve(JSON.parse(buf || "{}"));
        });
      }
    ).on("error", reject);
  });
}

/* ================= READ ONE (SAFE) ================= */
async function readOne(table, filter) {
  const url =
    `${TABLE_ENDPOINT}/${table}()?${TABLE_SAS}` +
    `&$format=application/json;odata=nometadata` +
    `&$top=1` +
    `&$filter=${encodeURIComponent(filter)}`;

  const r = await tableGET(url);
  return r.value && r.value[0];
}

/* ================= FAST LATEST ROW ================= */
async function getLatestFromTable(table, inverter, date) {
  const rkStart = `${date}_${inverter}_`;
  const rkEnd = `${date}_${inverter}_\uFFFF`;

  const url =
    `${TABLE_ENDPOINT}/${table}()?${TABLE_SAS}` +
    `&$format=application/json;odata=nometadata` +
    `&$filter=${encodeURIComponent(
      `PartitionKey eq '${inverter}' and RowKey ge '${rkStart}' and RowKey lt '${rkEnd}'`
    )}` +
    `&$select=RowKey` +
    `&$top=1000`;

  const r = await tableGET(url);
  if (!r.value || !r.value.length) return null;

  let maxRK = r.value[0].RowKey;
  for (const x of r.value) {
    if (x.RowKey > maxRK) maxRK = x.RowKey;
  }

  const entityUrl =
    `${TABLE_ENDPOINT}/${table}(PartitionKey='${inverter}',RowKey='${maxRK}')?${TABLE_SAS}` +
    `&$format=application/json;odata=nometadata`;

  return await tableGET(entityUrl);
}

/* ================= MAIN ================= */
module.exports = async function (context, req) {
  try {
    const inverter = String(req.query.inverter || "").trim();
    const date = String(req.query.date || "").trim();

    if (!inverter || !date) {
      context.res = {
        status: 400,
        body: { success: false, error: "Missing inverter/date" }
      };
      return;
    }

    /* ---------- FAST PARALLEL LATEST ---------- */
    const results = await Promise.all(
      INVERTER_TABLES.map(t =>
        getLatestFromTable(t, inverter, date).catch(() => null)
      )
    );

    let latest = null;
    let latestRK = "";

    for (const r of results) {
      if (!r || !r.RowKey) continue;
      if (!latest || r.RowKey > latestRK) {
        latest = r;
        latestRK = r.RowKey;
      }
    }

    if (!latest) {
      context.res = {
        status: 404,
        body: { success: false, message: "No data found" }
      };
      return;
    }

    /* ================= SERIAL (SINGLE SOURCE OF TRUTH) ================= */
    try {
      const master = await readOne(
        MASTER_TABLE,
        `Inverter_Model eq '${latest.Inverter_Model}'`
      );

      if (master?.Inverter_Serial_No) {
        latest.Inverter_Serial_No = master.Inverter_Serial_No;
      }
    } catch (e) {
      context.log("⚠️ Serial lookup failed:", e.message);
    }

    /* ---------- FINAL GUARANTEE ---------- */
    if (!latest.Inverter_Serial_No) {
      latest.Inverter_Serial_No = "--";
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, record: latest }
    };
  } catch (e) {
    context.log("❌ GetInverterDataOverview error:", e.message);
    context.res = {
      status: 500,
      body: { success: false, error: e.message }
    };
  }
};
